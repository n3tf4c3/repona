const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PendingDeleteOperation = { operationId: string; casaCode: string };

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('CORRUPT_PENDING_OPERATION');
  }
}

export function hasPendingDeleteOperation(stored: string | null): boolean {
  // Mesmo corrompido pode representar request remoto que commitou ou ainda
  // está in-flight. Só a ação explícita de DELETE pode resolvê-lo.
  return stored !== null;
}

export function resolveDeleteOperation(
  stored: string | null,
  casaCode: string,
  generate: () => string,
): PendingDeleteOperation {
  if (stored) {
    const value = parseJson(stored) as Partial<PendingDeleteOperation>;
    if (
      value.casaCode === casaCode &&
      typeof value.operationId === 'string' &&
      UUID_V4_REGEX.test(value.operationId)
    ) {
      return { operationId: value.operationId, casaCode };
    }
    throw new Error('PENDING_DELETE_CONFLICT');
  }
  const operationId = generate();
  if (!UUID_V4_REGEX.test(operationId)) throw new Error('INVALID_OPERATION_ID');
  return { operationId, casaCode };
}
