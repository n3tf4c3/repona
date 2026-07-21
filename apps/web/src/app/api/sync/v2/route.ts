import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  SYNC_COLLECTIONS,
  SYNC_PROTOCOL_VERSION,
  isBoundedSyncPage,
  type SyncCollection,
} from "@repona/core";
import { readBoundedJson, RequestBodyTooLargeError } from "@/server/boundedJson";
import { obterCasaPorCodigo, CASA_CODE_REGEX } from "@/server/modules/casa";
import {
  construirSnapshotPage,
  mergeCasaSnapshot,
  SyncConcurrentMutationError,
  SyncLockLostError,
  SyncUnknownProductError,
} from "@/server/modules/sync";
import { rateLimited, tryLock, unlock, ipDaRequest } from "@/server/rateLimit";
import { fingerprintToken } from "@/server/rateLimitToken";
import {
  parseSyncClientVersion,
  snapshotSchema,
  syncTargetMatches,
} from "@/server/syncSchemas";
import { decodeSyncCursor } from "@/server/syncCursor";
import { logSyncTelemetry } from "@/server/syncTelemetry";

const MAX_PAGE_BODY_BYTES = 512 * 1024;
const RATE_WINDOW_SECONDS = 60;
// Uma primeira carga no máximo do contrato legado demanda cerca de 240 páginas
// somando upload/download. O bucket v2 comporta isso, mas ainda limita custo por
// casa; o bucket por IP é maior para não punir casas atrás do mesmo NAT. (#55/#74)
const MAX_PAGES_PER_TOKEN = 300;
const MAX_PAGES_PER_IP = 600;
const PAGE_LEASE_SECONDS = 30;

const requestSchema = z.discriminatedUnion("phase", [
  z.object({
    protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
    phase: z.literal("upload"),
    pageId: z.string().uuid(),
    collection: z.enum(SYNC_COLLECTIONS),
    snapshot: snapshotSchema,
    expectedCasaId: z.number().int().positive().optional(),
  }),
  z.object({
    protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
    phase: z.literal("download"),
    cursor: z.string().max(256).nullish(),
    expectedCasaId: z.number().int().positive().optional(),
  }),
]);

function jsonV2(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("x-repona-sync-protocol", String(SYNC_PROTOCOL_VERSION));
  return response;
}

export async function POST(request: NextRequest) {
  const parsedClientVersion = parseSyncClientVersion(
    request.headers.get("x-repona-client-version")
  );
  const clientVersion = parsedClientVersion ?? "invalid";
  let telemetryPhase: "upload" | "download" | "unknown" = "unknown";
  const reply = (body: unknown, init: ResponseInit | undefined, outcome: string) => {
    logSyncTelemetry({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      clientVersion,
      phase: telemetryPhase,
      outcome,
    });
    return jsonV2(body, init);
  };

  if (request.headers.get("x-repona-sync-protocol") !== String(SYNC_PROTOCOL_VERSION)) {
    return reply({ error: "UNSUPPORTED_PROTOCOL" }, { status: 426 }, "unsupported_protocol");
  }
  if (!parsedClientVersion) {
    return reply({ error: "INVALID_CLIENT_VERSION" }, { status: 400 }, "invalid_client_version");
  }

  const ip = ipDaRequest(request.headers);
  if (
    await rateLimited(`sync-v2:${ip}`, MAX_PAGES_PER_IP, RATE_WINDOW_SECONDS)
  ) {
    return reply(
      { error: "RATE_LIMITED", retryAfterSeconds: RATE_WINDOW_SECONDS },
      { status: 429, headers: { "Retry-After": String(RATE_WINDOW_SECONDS) } },
      "rate_limited_ip"
    );
  }

  const code = request.headers.get("x-casa-code")?.trim().toUpperCase() ?? "";
  const tokenKey = CASA_CODE_REGEX.test(code) ? code : "invalido";
  if (
    await rateLimited(
      `sync-v2:token:${fingerprintToken(tokenKey, "sync")}`,
      MAX_PAGES_PER_TOKEN,
      RATE_WINDOW_SECONDS
    )
  ) {
    return reply(
      { error: "RATE_LIMITED", retryAfterSeconds: RATE_WINDOW_SECONDS },
      { status: 429, headers: { "Retry-After": String(RATE_WINDOW_SECONDS) } },
      "rate_limited_token"
    );
  }

  const casaId = await obterCasaPorCodigo(code);
  if (!casaId) return reply({ error: "CASA_NOT_FOUND" }, { status: 404 }, "casa_not_found");

  let raw: unknown;
  try {
    raw = await readBoundedJson(request, MAX_PAGE_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return reply({ error: "PAGE_TOO_LARGE" }, { status: 413 }, "page_too_large");
    }
    return reply({ error: "INVALID_JSON" }, { status: 400 }, "invalid_json");
  }

  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return reply({ error: "INVALID_BODY" }, { status: 400 }, "invalid_body");
  telemetryPhase = parsed.data.phase;

  // O vínculo atômico do app informa a casa esperada. Esta verificação
  // acontece depois de autenticar o token e ANTES de qualquer merge/lock: um
  // token e um arquivo SQLite de gerações diferentes nunca enviam a 1ª página.
  if (!syncTargetMatches(casaId, parsed.data.expectedCasaId)) {
    return reply({ error: "CASA_MISMATCH" }, { status: 412 }, "casa_mismatch");
  }

  if (parsed.data.phase === "download") {
    const cursor = decodeSyncCursor(parsed.data.cursor);
    if (!cursor) return reply({ error: "INVALID_CURSOR" }, { status: 400 }, "invalid_cursor");
    // O merge de produto reserva IDs depois de obter esta mesma lease, mas antes
    // do advisory transacional. No primeiro download, a lease + o advisory do
    // capture garantem que nenhum ID baixo reservado apareça depois do watermark.
    const captureLockKey = `sync:lock:${casaId}`;
    const captureLockToken = cursor.highWater
      ? null
      : await tryLock(captureLockKey, PAGE_LEASE_SECONDS);
    if (!cursor.highWater && !captureLockToken) {
      return reply({ error: "SYNC_IN_PROGRESS" }, { status: 409 }, "busy");
    }
    try {
      const page = await construirSnapshotPage(casaId, cursor);
      return reply({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        phase: "download",
        casaId,
        page: page.snapshot,
        collection: page.collection,
        nextCursor: page.nextCursor,
        serverTime: new Date().toISOString(),
      }, undefined, "ok");
    } catch (error) {
      logSyncTelemetry({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        clientVersion,
        phase: telemetryPhase,
        outcome: "server_error",
      });
      throw error;
    } finally {
      if (captureLockToken) await unlock(captureLockKey, captureLockToken);
    }
  }

  const collection = parsed.data.collection as SyncCollection;
  if (!isBoundedSyncPage(parsed.data.snapshot, collection)) {
    return reply({ error: "PAGE_ITEM_LIMIT_EXCEEDED" }, { status: 413 }, "item_limit");
  }

  const lockKey = `sync:lock:${casaId}`;
  const lockToken = await tryLock(lockKey, PAGE_LEASE_SECONDS);
  if (!lockToken) return reply({ error: "SYNC_IN_PROGRESS" }, { status: 409 }, "busy");

  try {
    await mergeCasaSnapshot(casaId, parsed.data.snapshot, {
      returnSnapshot: false,
      fence: { key: lockKey, token: lockToken, ttlSeconds: PAGE_LEASE_SECONDS },
    });
    // O pageId é devolvido somente depois do commit. Repetir a mesma página é
    // seguro por UUID/LWW; o cliente só avança o cursor ao receber este ACK.
    return reply({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      phase: "upload",
      casaId,
      ackPageId: parsed.data.pageId,
      serverTime: new Date().toISOString(),
    }, undefined, "ok");
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
    logSyncTelemetry({
      protocolVersion: SYNC_PROTOCOL_VERSION,
      clientVersion,
      phase: telemetryPhase,
      outcome: "server_error",
    });
    throw error;
  } finally {
    // Compare-and-delete: nunca libera a lease de um sucessor.
    await unlock(lockKey, lockToken);
  }
}
