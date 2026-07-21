import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export const OPERATION_VERIFIER_REGEX = /^[0-9a-f]{64}$/;
export type VerifierOperationType = "create" | "rotate";
export type AccountOperationType = "create" | "delete" | "rotate";

function verifierKey(inviteSecret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(inviteSecret, "utf8"),
      Buffer.alloc(0),
      "repona-account-operation-verifier-key-v1",
      32
    )
  );
}

function requestHashKey(inviteSecret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(inviteSecret, "utf8"),
      Buffer.alloc(0),
      "repona-account-operation-request-hash-key-v1",
      32
    )
  );
}

export function accountOperationRequestHashWithSecret(
  payload: string,
  operationType: AccountOperationType,
  inviteSecret: string
): string {
  return createHmac("sha256", requestHashKey(inviteSecret))
    .update(`repona:account-operation-request:${operationType}:v1:${payload}`)
    .digest("base64url");
}

// O verifier acompanha a chave estável da cifra dos tokens. Ele não usa o
// RATE_LIMIT_PEPPER, que pode ser trocado para reiniciar buckets sem invalidar
// recibos de operações ainda recuperáveis.
export function operationVerifierHashWithSecret(
  verifier: string,
  operationType: VerifierOperationType,
  inviteSecret: string
): string {
  if (!OPERATION_VERIFIER_REGEX.test(verifier)) {
    throw new Error("INVALID_OPERATION_VERIFIER");
  }
  return createHmac("sha256", verifierKey(inviteSecret))
    .update(`repona:account-operation:${operationType}:v1:${verifier}`)
    .digest("base64url");
}

export function operationVerifierMatches(
  storedHash: string | null,
  receivedHash: string
): boolean {
  if (!storedHash || storedHash.length !== receivedHash.length) return false;
  return timingSafeEqual(Buffer.from(storedHash), Buffer.from(receivedHash));
}
