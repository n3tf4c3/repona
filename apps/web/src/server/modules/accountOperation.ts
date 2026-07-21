export const IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT";
export const IDEMPOTENCY_RESULT_GONE = "IDEMPOTENCY_RESULT_GONE";

export type AccountOperationType = "create" | "delete";

export type StoredAccountOperation = {
  operationType: string;
  requestHash: string;
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

