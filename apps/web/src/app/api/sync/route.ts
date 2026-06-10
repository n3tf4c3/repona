import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FIELD_LIMITS } from "@repona/core";
import { obterCasaPorCodigo } from "@/server/modules/casa";
import { mergeCasaSnapshot } from "@/server/modules/sync";
import { rateLimited, tryLock, unlock } from "@/server/rateLimit";

// Limites de tamanho vêm do @repona/core (fonte única), os mesmos validados na
// criação de produto — assim a criação nunca gera um valor que o sync rejeita.
const snapshotSchema = z.object({
  products: z
    .array(
      z.object({
        syncId: z.string().uuid().optional(),
        updatedAt: z.string().datetime({ offset: true }).optional(),
        name: z.string().trim().min(1).max(FIELD_LIMITS.name),
        category: z.string().max(FIELD_LIMITS.category),
        // Clientes antigos não enviam brand: default mantém compat.
        brand: z.string().max(FIELD_LIMITS.brand).nullish().default(null),
        barcode: z.string().max(FIELD_LIMITS.barcode).nullable(),
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
        priceCents: z.number().int().min(1).max(100_000_000),
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

// Rate limit por IP via Vercel KV (auditoria #12), com fallback em memória.
const JANELA_SEG = 60;
const MAX_POR_JANELA = 30;

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
  if (await rateLimited(`sync:${ip}`, MAX_POR_JANELA, JANELA_SEG)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const code = req.headers.get("x-casa-code")?.trim().toUpperCase() ?? "";
  const casaId = await obterCasaPorCodigo(code);
  if (!casaId) {
    return NextResponse.json({ error: "CASA_NOT_FOUND" }, { status: 404 });
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
  if (!(await tryLock(lockKey, 60))) {
    return NextResponse.json({ error: "SYNC_IN_PROGRESS" }, { status: 409 });
  }
  try {
    const merged = await mergeCasaSnapshot(casaId, parsed.data);
    return NextResponse.json(merged);
  } finally {
    await unlock(lockKey);
  }
}
