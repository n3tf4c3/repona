import { operationVerifierMatches } from "../operationVerifierHash";

export const IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT";
export const IDEMPOTENCY_RESULT_GONE = "IDEMPOTENCY_RESULT_GONE";

export type AccountOperationType = "create" | "delete" | "rotate";

export type StoredAccountOperation = {
  operationType: string;
  requestHash: string;
};

export type StoredVersionedAccountOperation = StoredAccountOperation & {
  operationVersion: number;
};

export type StoredTokenReturningOperation = StoredAccountOperation & {
  operationVersion: number;
  operationVerifierHash: string | null;
  resultTokenEnc: string | null;
};

export function assertSameAccountOperation(
  operation: StoredAccountOperation,
  operationType: AccountOperationType,
  requestHash: string
): void {
  // A mesma chave nunca pode ser reaproveitada para outra mutação ou outro
  // payload. Isso transforma bugs/colisões do cliente em 409, em vez de devolver
  // o resultado de uma conta diferente. (auditoria #90)
  if (operation.operationType !== operationType || operation.requestHash !== requestHash) {
    throw new Error(IDEMPOTENCY_CONFLICT);
  }
}

export function assertDeleteAccountOperationReplay(
  operation: StoredVersionedAccountOperation,
  requestHash: string,
  legacyRequestHash: string
): void {
  if (operation.operationType !== "delete") {
    throw new Error(IDEMPOTENCY_CONFLICT);
  }

  if (operation.operationVersion === 2) {
    assertSameAccountOperation(operation, "delete", requestHash);
    return;
  }

  // Recibos v1 foram persistidos antes da separação entre o hash durável e o
  // pepper de rate limit. Eles só podem ser reconhecidos ao recomputar o hash
  // legado exato; operationId+tipo, isoladamente, jamais confirmam o alvo.
  if (operation.operationVersion === 1 && operation.requestHash === legacyRequestHash) {
    return;
  }

  throw new Error(IDEMPOTENCY_CONFLICT);
}

export function assertRecoverableTokenOperation(
  operation: StoredTokenReturningOperation,
  operationType: "create" | "rotate",
  verifierHash: string,
  requestHash?: string
): asserts operation is StoredTokenReturningOperation & {
  operationVersion: 2;
  resultTokenEnc: string;
  operationVerifierHash: string;
} {
  if (
    operation.operationVersion !== 2 ||
    operation.operationType !== operationType ||
    !operation.resultTokenEnc ||
    !operationVerifierMatches(operation.operationVerifierHash, verifierHash)
  ) {
    throw new Error(IDEMPOTENCY_CONFLICT);
  }
  if (requestHash !== undefined) {
    assertSameAccountOperation(operation, operationType, requestHash);
  }
}
