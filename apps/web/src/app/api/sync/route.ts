import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CATEGORIAS, FIELD_LIMITS, MAX_PRICE_CENTS } from "@repona/core";
import { obterCasaPorCodigo, CASA_CODE_REGEX } from "@/server/modules/casa";
import { mergeCasaSnapshot } from "@/server/modules/sync";
import { rateLimited, tryLock, unlock, ipDaRequest } from "@/server/rateLimit";

// Limites de tamanho vêm do @repona/core (fonte única), os mesmos validados na
// criação de produto — assim a criação nunca gera um valor que o sync rejeita.
const snapshotSchema = z.object({
  products: z
    .array(
      z.object({
        syncId: z.string().uuid().optional(),
        updatedAt: z.string().datetime({ offset: true }).optional(),
        name: z.string().trim().min(1).max(FIELD_LIMITS.name),
        // Mesmo enum validado na criação/edição do web. Um cliente antigo ou
        // corrompido pode mandar categoria fora do enum; normaliza para o padrão
        // ("Mercearia", o default do mobile) em vez de rejeitar o snapshot
        // INTEIRO da casa. (auditoria #60)
        category: z.enum(CATEGORIAS).catch("Mercearia"),
        // Clientes antigos não enviam brand: default mantém compat.
        brand: z.string().max(FIELD_LIMITS.brand).nullish().default(null),
        // Normaliza: trim e vazio -> null, para "789" e " 789 " não virarem
        // códigos distintos e o índice único bater no valor limpo. (auditoria #37)
        barcode: z
          .string()
          .max(FIELD_LIMITS.barcode)
          .nullable()
          .transform((v) => (v && v.trim() ? v.trim() : null)),
        purchaseCount: z.number().int().min(0),
        status: z.enum(["active", "missing"]),
        alertThreshold: z.string().max(FIELD_LIMITS.alertThreshold).nullable(),
        inventoryQuantity: z.string().max(FIELD_LIMITS.quantity),
        inventoryStatus: z.enum(["in_stock", "missing"]),
        // Clientes antigos não enviam archived/occasional: default mantém compat.
        archived: z.boolean().optional().default(false),
        occasional: z.boolean().optional().default(false),
      })
    )
    .max(2000),
  purchases: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(FIELD_LIMITS.name),
        quantity: z.string().max(FIELD_LIMITS.quantity),
        purchasedAt: z.string().datetime({ offset: true }),
        sourceListName: z.string().max(120).nullish(),
        // Tombstone da edição do histórico. Opcional: clientes antigos não enviam.
        deleted: z.boolean().optional().default(false),
      })
    )
    .max(10000),
  consumptions: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(FIELD_LIMITS.name),
        quantity: z.string().max(FIELD_LIMITS.quantity),
        occurredAt: z.string().datetime({ offset: true }),
      })
    )
    .max(10000),
  prices: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(FIELD_LIMITS.name),
        priceCents: z.number().int().min(1).max(MAX_PRICE_CENTS),
        recordedAt: z.string().datetime({ offset: true }),
      })
    )
    .max(10000),
  // Itens da lista ativa (auditoria #9). Opcional: clientes antigos não enviam.
  listItems: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(FIELD_LIMITS.name),
        quantity: z.string().max(FIELD_LIMITS.quantity),
        checked: z.boolean(),
        deleted: z.boolean(),
        updatedAt: z.string().datetime({ offset: true }),
      })
    )
    .max(2000)
    .optional()
    .default([]),
});

// Rate limit do sync (auditoria #12) sobre o Postgres (auditoria #44, não há
// mais Vercel KV nem fallback em memória). Por IP e por token: sem a chave por
// token, tentativas contra uma casa podiam ser distribuídas por vários IPs sem
// esbarrar no limite — mesma defesa que o login ganhou no #20. O teto por token
// é folgado para não bloquear uma casa com vários aparelhos sincronizando.
// (auditoria #47)
const JANELA_SEG = 60;
const MAX_POR_JANELA = 30;
const MAX_POR_TOKEN = 60;

// Teto de bytes do corpo, checado antes do req.json(): um snapshot cheio (2k
// produtos + 30k eventos) fica bem abaixo disto. Rejeita cedo, sem gastar
// memória/CPU no parse de um payload gigante. (auditoria #55)
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const ip = ipDaRequest(req.headers);
  if (await rateLimited(`sync:${ip}`, MAX_POR_JANELA, JANELA_SEG)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const code = req.headers.get("x-casa-code")?.trim().toUpperCase() ?? "";
  // Chave de rate limit por token só com formato válido; um header arbitrário cai
  // num bucket fixo, para não inflar rate_limits com valores distintos. (#54)
  const tokenKey = CASA_CODE_REGEX.test(code) ? code : "invalido";
  if (await rateLimited(`sync:token:${tokenKey}`, MAX_POR_TOKEN, JANELA_SEG)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  const casaId = await obterCasaPorCodigo(code);
  if (!casaId) {
    return NextResponse.json({ error: "CASA_NOT_FOUND" }, { status: 404 });
  }

  const tamanho = Number(req.headers.get("content-length"));
  if (Number.isFinite(tamanho) && tamanho > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = snapshotSchema.safeParse(body);
  if (!parsed.success) {
    // Distingue "snapshot grande demais" (limite de itens dos arrays) de corpo
    // malformado: o primeiro é acionável (reduzir a janela de envio) e antes era
    // indistinguível de um bug. (auditoria 2026-06-09 #7)
    const estourouLimite = parsed.error.issues.some(
      (issue) => issue.code === "too_big" && issue.origin === "array"
    );
    return NextResponse.json(
      { error: estourouLimite ? "SNAPSHOT_TOO_LARGE" : "INVALID_BODY" },
      { status: estourouLimite ? 413 : 400 }
    );
  }

  // Serializa o merge por casa: dois devices sincronizando juntos podem inserir
  // o mesmo produto e violar os índices únicos no meio do merge (que não roda em
  // transação no driver neon-http). O merge é idempotente, então o device que
  // não pegou o lock só precisa tentar de novo. (auditoria 2026-06-09 #1)
  const lockKey = `sync:lock:${casaId}`;
  const lockToken = await tryLock(lockKey, 60);
  if (!lockToken) {
    return NextResponse.json({ error: "SYNC_IN_PROGRESS" }, { status: 409 });
  }
  try {
    const merged = await mergeCasaSnapshot(casaId, parsed.data);
    return NextResponse.json(merged);
  } finally {
    await unlock(lockKey, lockToken);
  }
}
