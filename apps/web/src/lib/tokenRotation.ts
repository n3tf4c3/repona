import { CASA_CODE_CURRENT_REGEX, CASA_CODE_REGEX } from "@repona/core";
import type { OperationStorage } from "./idempotentMutation";

export type TokenRotationMode = "rotate" | "migrate";

export type TokenRotationOperation = {
  mode: TokenRotationMode;
  operationId: string;
  verifier: string;
  sourceProof?: string;
};

export type TokenRotationResponse = {
  token: string;
  casaId: number;
  credentialVersion: number;
  operation: TokenRotationOperation;
};

export class TokenRotationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
    this.name = "TokenRotationError";
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERIFIER_RE = /^[0-9a-f]{64}$/;
const SOURCE_PROOF_CONTEXT = "repona-token-rotation-source-v1";
const ephemeralSourceTokens = new Map<string, string>();

function storageKey(mode: TokenRotationMode): string {
  return `repona:pending-token-rotation:${mode}`;
}

function generateVerifier(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new TokenRotationError("SECURE_RANDOM_UNAVAILABLE", 500);
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sourceProof(token: string, verifier: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new TokenRotationError("SECURE_RANDOM_UNAVAILABLE", 500);
  }
  const value = new TextEncoder().encode(
    `${SOURCE_PROOF_CONTEXT}\u0000${verifier}\u0000${token}`
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function parsePending(
  raw: string | null,
  mode: TokenRotationMode
): TokenRotationOperation | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<TokenRotationOperation>;
    if (
      value.mode === mode &&
      typeof value.operationId === "string" &&
      UUID_RE.test(value.operationId) &&
      typeof value.verifier === "string" &&
      VERIFIER_RE.test(value.verifier) &&
      (value.sourceProof === undefined ||
        (typeof value.sourceProof === "string" && VERIFIER_RE.test(value.sourceProof)))
    ) {
      return value as TokenRotationOperation;
    }
  } catch {
    // O registro pode corresponder a um commit sem resposta. Não o sobrescreve.
  }
  throw new TokenRotationError("CORRUPT_PENDING_ROTATION", 409);
}

function readPending(
  mode: TokenRotationMode,
  storage: OperationStorage
): TokenRotationOperation | null {
  return parsePending(storage.getItem(storageKey(mode)), mode);
}

async function getOrCreatePending(
  mode: TokenRotationMode,
  sourceToken: string,
  storage: OperationStorage
): Promise<TokenRotationOperation> {
  const pending = readPending(mode, storage);
  if (pending) return pending;

  const operationId = globalThis.crypto?.randomUUID?.();
  if (!operationId || !UUID_RE.test(operationId)) {
    throw new TokenRotationError("SECURE_RANDOM_UNAVAILABLE", 500);
  }
  const created: TokenRotationOperation = {
    mode,
    operationId,
    verifier: generateVerifier(),
  };
  // O legado de 8 caracteres tem só ~40 bits: um proof persistido viraria um
  // oracle offline para força bruta. Ele pode ser retomado na mesma aba, mas,
  // após reload, permanece recovery-only. Tokens de 12/26 caracteres recebem
  // apenas o digest contextual — nunca o bearer — para validar o retry.
  if (sourceToken.length !== 8) {
    created.sourceProof = await sourceProof(sourceToken, created.verifier);
  }
  storage.setItem(storageKey(mode), JSON.stringify(created));
  ephemeralSourceTokens.set(created.operationId, sourceToken);
  return created;
}

function clearIfCurrent(
  operation: TokenRotationOperation,
  storage: OperationStorage
): void {
  const current = readPending(operation.mode, storage);
  if (
    current?.operationId === operation.operationId &&
    current.verifier === operation.verifier
  ) {
    storage.removeItem(storageKey(operation.mode));
    ephemeralSourceTokens.delete(operation.operationId);
  }
}

async function patchRotation(
  operation: TokenRotationOperation,
  bodyValue: { mode: TokenRotationMode | "recover" },
  token: string | null,
  fetcher: FetchLike
): Promise<TokenRotationResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Idempotency-Key": operation.operationId,
      "x-operation-verifier": operation.verifier,
    };
    const requestId = globalThis.crypto?.randomUUID?.();
    if (requestId && UUID_RE.test(requestId)) headers["x-request-id"] = requestId;
    if (token !== null) headers["x-casa-code"] = token;
    response = await fetcher("/api/casa", {
      method: "PATCH",
      headers,
      body: JSON.stringify(bodyValue),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Resposta inválida mantém o registro: o servidor pode ter feito commit.
  }
  if (!response.ok) {
    const code =
      body && typeof body === "object" && !Array.isArray(body) &&
      typeof (body as Record<string, unknown>).error === "string"
        ? String((body as Record<string, unknown>).error)
        : "TOKEN_ROTATION_FAILED";
    throw new TokenRotationError(code, response.status);
  }

  const result = parseResult(body);
  if (!result) throw new TokenRotationError("INVALID_SERVER_RESPONSE", 500);
  return { ...result, operation };
}

function parseResult(value: unknown): Omit<TokenRotationResponse, "operation"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (
    typeof result.token !== "string" ||
    !CASA_CODE_CURRENT_REGEX.test(result.token) ||
    typeof result.casaId !== "number" ||
    !Number.isSafeInteger(result.casaId) ||
    result.casaId <= 0 ||
    typeof result.credentialVersion !== "number" ||
    !Number.isSafeInteger(result.credentialVersion) ||
    result.credentialVersion < 0
  ) {
    return null;
  }
  return {
    token: result.token,
    casaId: result.casaId,
    credentialVersion: result.credentialVersion,
  };
}

export async function requestTokenRotation(
  rawToken: string,
  mode: TokenRotationMode,
  storage: OperationStorage,
  fetcher: FetchLike = fetch
): Promise<TokenRotationResponse> {
  const token = rawToken.trim().toUpperCase();
  if (!CASA_CODE_REGEX.test(token)) throw new TokenRotationError("INVALID_CODE", 400);

  const existing = readPending(mode, storage);
  const operation = existing ?? await getOrCreatePending(mode, token, storage);
  if (existing) {
    try {
      // Pode ter havido commit+reauth e crash antes do ACK. Recuperar primeiro
      // evita reapresentar o token já novo como payload da operação antiga.
      return await patchRotation(operation, { mode: "recover" }, null, fetcher);
    } catch (error) {
      if (
        !(error instanceof TokenRotationError) ||
        error.code !== "TOKEN_ROTATION_RECEIPT_NOT_FOUND"
      ) {
        throw error;
      }
      // 404 não é terminal: a tentativa inicial pode ainda estar esperando lock.
    }
    const matchesSource = operation.sourceProof
      ? (await sourceProof(token, operation.verifier)) === operation.sourceProof
      : ephemeralSourceTokens.get(operation.operationId) === token;
    if (!operation.sourceProof && !ephemeralSourceTokens.has(operation.operationId)) {
      throw new TokenRotationError("PENDING_ROTATION_RECOVERY", 409);
    }
    if (!matchesSource) {
      throw new TokenRotationError("PENDING_TOKEN_ROTATION", 409);
    }
  }
  return patchRotation(operation, { mode }, token, fetcher);
}

export async function recoverPendingTokenRotation(
  mode: TokenRotationMode,
  storage: OperationStorage,
  fetcher: FetchLike = fetch
): Promise<TokenRotationResponse | null> {
  const operation = readPending(mode, storage);
  if (!operation) return null;
  try {
    return await patchRotation(operation, { mode: "recover" }, null, fetcher);
  } catch (error) {
    if (
      error instanceof TokenRotationError &&
      error.code === "IDEMPOTENCY_RESULT_GONE"
    ) {
      clearIfCurrent(operation, storage);
    }
    throw error;
  }
}

export function acknowledgeTokenRotation(
  operation: TokenRotationOperation,
  storage: OperationStorage
): void {
  clearIfCurrent(operation, storage);
}
