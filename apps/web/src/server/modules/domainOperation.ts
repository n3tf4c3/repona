export const DOMAIN_IDEMPOTENCY_CONFLICT = "DOMAIN_IDEMPOTENCY_CONFLICT";
export const DOMAIN_OPERATION_RESULT_MISSING = "DOMAIN_OPERATION_RESULT_MISSING";

export type DomainOperationType = "consume" | "finalize-purchase";

export type DomainOperationReceipt = {
  operationType: string;
  casaId: number;
  resourceId: number | null;
  resultCount: number;
};

export function assertSameDomainOperation(
  receipt: DomainOperationReceipt,
  expected: {
    operationType: DomainOperationType;
    casaId: number;
    resourceId: number;
  }
): void {
  if (
    receipt.operationType !== expected.operationType ||
    receipt.casaId !== expected.casaId ||
    receipt.resourceId !== expected.resourceId
  ) {
    throw new Error(DOMAIN_IDEMPOTENCY_CONFLICT);
  }
}
