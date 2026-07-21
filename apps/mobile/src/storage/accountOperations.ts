import { uuidv4 } from '@repona/core';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PendingDeleteOperation = { operationId: string; casaCode: string };

function newOperationId(generate: () => string): string {
  const operationId = generate();
  if (!UUID_V4_REGEX.test(operationId)) throw new Error('INVALID_OPERATION_ID');
  return operationId;
}

export function resolveCreateOperationId(
  stored: string | null,
  generate: () => string = uuidv4,
): string {
  return stored && UUID_V4_REGEX.test(stored) ? stored : newOperationId(generate);
}

export function resolveDeleteOperation(
  stored: string | null,
  casaCode: string,
  generate: () => string = uuidv4,
): PendingDeleteOperation {
  if (stored) {
    try {
      const value = JSON.parse(stored) as Partial<PendingDeleteOperation>;
      if (
        value.casaCode === casaCode &&
        typeof value.operationId === 'string' &&
        UUID_V4_REGEX.test(value.operationId)
      ) {
        return { operationId: value.operationId, casaCode };
      }
    } catch {
      // Estado interrompido/corrompido é substituído antes do próximo request.
    }
  }
  return { operationId: newOperationId(generate), casaCode };
}

