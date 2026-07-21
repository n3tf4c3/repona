import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CATEGORIAS, FIELD_LIMITS, MAX_PRICE_CENTS, canonicalQuantity } from "@repona/core";
import { obterCasaPorCodigo, CASA_CODE_REGEX } from "@/server/modules/casa";
import {
  mergeCasaSnapshot,
  SyncConcurrentMutationError,
  SyncLockLostError,
  SyncUnknownProductError,
} from "@/server/modules/sync";
import { rateLimited, tryLock, unlock, ipDaRequest } from "@/server/rateLimit";
import { fingerprintToken } from "@/server/rateLimitToken";
import { readBoundedJson, RequestBodyTooLargeError } from "@/server/boundedJson";
import { parseSyncClientVersion } from "@/server/syncSchemas";
import { logSyncTelemetry, syncRequestId } from "@/server/syncTelemetry";

// Limites de tamanho vêm do @repona/core (fonte única), os mesmos validados na
// criação de produto — assim a criação nunca gera um valor que o sync rejeita.
const snapshotSchema = z.object({
  products: z
    .array(
      z.object({
        syncId: z.string().uuid().optional(),
        updatedAt: z.string().datetime({ offset: true }).optional(),
        metadataUpdatedAt: z.string().datetime({ offset: true }).optional(),
        inventoryUpdatedAt: z.string().datetime({ offset: true }).optional(),
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
        // Canonicaliza: vazio/"abc"/"1 ???" -> "0 un" em vez de virar
        // status/estoque inválido. Estoque aceita zero. (auditoria #75)
        inventoryQuantity: z
          .string()
          .max(FIELD_LIMITS.quantity)
          .transform((v) => canonicalQuantity(v, "0 un", { allowZero: true })),
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
        syncId: z.string().uuid().optional(),
        productName: z.string().trim().min(1).max(FIELD_LIMITS.name),
        quantity: z
          .string()
          .max(FIELD_LIMITS.quantity)
          .transform((v) => canonicalQuantity(v, "1 un")),
        purchasedAt: z.string().datetime({ offset: true }),
        sourceListName: z.string().max(120).nullish(),
        // Tombstone da edição do histórico. Opcional: clientes antigos não enviam.
        deleted: z.boolean().optional().default(false),
        // Carimbo da edição do tombstone (LWW do un-delete, auditoria #65).
        updatedAt: z.string().datetime({ offset: true }).nullish(),
      })
    )
    .max(10000),
  consumptions: z
    .array(
      z.object({
        syncId: z.string().uuid().optional(),
        eventType: z.enum(["consumed", "set"]).optional().default("consumed"),
        productName: z.string().trim().min(1).max(FIELD_LIMITS.name),
        quantity: z.string().max(FIELD_LIMITS.quantity),
        occurredAt: z.string().datetime({ offset: true }),
      })
    )
    .max(10000)
    .transform((events) =>
      events.map((event) => ({
        ...event,
        quantity: canonicalQuantity(
          event.quantity,
          event.eventType === "set" ? "0 un" : "1 un",
          { allowZero: event.eventType === "set" }
        ),
      }))
    ),
  prices: z
    .array(
      z.object({
        syncId: z.string().uuid().optional(),
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
        quantity: z
          .string()
          .max(FIELD_LIMITS.quantity)
          .transform((v) => canonicalQuantity(v, "1 un")),
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
const MAX_BODY_BYTES = 4 * 1024 * 1024;

function jsonV1(body: unknown, requestId: string, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("x-repona-sync-protocol", "1");
  response.headers.set("x-request-id", requestId);
  return response;
}

async function postWithEnvelope(req: NextRequest, requestId: string) {
  const rawClientVersion = req.headers.get("x-repona-client-version");
  const clientVersion = parseSyncClientVersion(rawClientVersion) ??
    (rawClientVersion === null ? "legacy" : "invalid");
  const reply = (body: unknown, init: ResponseInit | undefined, outcome: string) => {
    logSyncTelemetry({
      protocolVersion: 1,
      clientVersion,
      phase: "snapshot",
      outcome,
      requestId,
    });
    return jsonV1(body, requestId, init);
  };

  const ip = ipDaRequest(req.headers);
  if (await rateLimited(`sync:${ip}`, MAX_POR_JANELA, JANELA_SEG)) {
    return reply({ error: "RATE_LIMITED" }, { status: 429 }, "rate_limited_ip");
  }

  const code = req.headers.get("x-casa-code")?.trim().toUpperCase() ?? "";
  // Chave de rate limit por token só com formato válido; um header arbitrário cai
  // num bucket fixo, para não inflar rate_limits com valores distintos. (#54)
  const tokenKey = CASA_CODE_REGEX.test(code) ? code : "invalido";
  // Fingerprint do token, não o token em claro, na chave persistida. (#43)
  if (await rateLimited(`sync:token:${fingerprintToken(tokenKey, "sync")}`, MAX_POR_TOKEN, JANELA_SEG)) {
    return reply({ error: "RATE_LIMITED" }, { status: 429 }, "rate_limited_token");
  }
  const casaId = await obterCasaPorCodigo(code);
  if (!casaId) {
    return reply({ error: "CASA_NOT_FOUND" }, { status: 404 }, "casa_not_found");
  }

  let body: unknown;
  try {
    body = await readBoundedJson(req, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return reply({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 }, "payload_too_large");
    }
    return reply({ error: "INVALID_JSON" }, { status: 400 }, "invalid_json");
  }

  const parsed = snapshotSchema.safeParse(body);
  if (!parsed.success) {
    // Distingue "snapshot grande demais" (limite de itens dos arrays) de corpo
    // malformado: o primeiro é acionável (reduzir a janela de envio) e antes era
    // indistinguível de um bug. (auditoria 2026-06-09 #7)
    const estourouLimite = parsed.error.issues.some(
      (issue) => issue.code === "too_big" && issue.origin === "array"
    );
    return reply(
      { error: estourouLimite ? "SNAPSHOT_TOO_LARGE" : "INVALID_BODY" },
      { status: estourouLimite ? 413 : 400 },
      estourouLimite ? "snapshot_too_large" : "invalid_body"
    );
  }

  // Serializa o merge por casa: dois devices sincronizando juntos podem inserir
  // o mesmo produto e violar os índices únicos no meio do merge (que não roda em
  // transação no driver neon-http). O merge é idempotente, então o device que
  // não pegou o lock só precisa tentar de novo. (auditoria 2026-06-09 #1)
  const lockKey = `sync:lock:${casaId}`;
  const lockToken = await tryLock(lockKey, 60);
  if (!lockToken) {
    return reply({ error: "SYNC_IN_PROGRESS" }, { status: 409 }, "busy");
  }
  try {
    const merged = await mergeCasaSnapshot(casaId, parsed.data, {
      fence: { key: lockKey, token: lockToken, ttlSeconds: 60 },
    });
    // casaId acompanha o snapshot mesclado: o mobile o usa para escopar os dados
    // por casa (arquivo SQLite por casa) e comparar com o local_casa_id, nunca
    // enviando dados de uma conta para outra. (auditoria #68)
    return reply({ ...merged, casaId }, undefined, "ok");
  } catch (error) {
    if (error instanceof SyncLockLostError) {
      return reply({ error: "SYNC_LOCK_LOST" }, { status: 409 }, "lock_lost");
    }
    if (error instanceof SyncConcurrentMutationError) {
      return reply(
        { error: "SYNC_CONCURRENT_MUTATION" },
        { status: 409 },
        "concurrent_mutation"
      );
    }
    if (error instanceof SyncUnknownProductError) {
      return reply(
        { error: "SYNC_UNKNOWN_PRODUCT" },
        { status: 409 },
        "unknown_product"
      );
    }
    return reply({ error: "SERVER_ERROR", requestId }, { status: 500 }, "server_error");
  } finally {
    try {
      await unlock(lockKey, lockToken);
    } catch {
      // A resposta do merge pode já estar pronta (inclusive após commit). Uma
      // indisponibilidade ao liberar a lease não deve substituí-la por uma
      // rejeição sem envelope; a lease tem TTL e expira de forma segura.
      logSyncTelemetry({
        protocolVersion: 1,
        clientVersion,
        phase: "snapshot",
        outcome: "unlock_failed",
        requestId,
      });
    }
  }
}

export async function POST(req: NextRequest) {
  const requestId = syncRequestId(req.headers.get("x-request-id"));
  try {
    return await postWithEnvelope(req, requestId);
  } catch {
    const rawClientVersion = req.headers.get("x-repona-client-version");
    logSyncTelemetry({
      protocolVersion: 1,
      clientVersion: parseSyncClientVersion(rawClientVersion) ??
        (rawClientVersion === null ? "legacy" : "invalid"),
      phase: "snapshot",
      outcome: "server_error",
      requestId,
    });
    return jsonV1({ error: "SERVER_ERROR", requestId }, requestId, { status: 500 });
  }
}
