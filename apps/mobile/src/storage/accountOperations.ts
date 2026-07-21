import { CASA_CODE_REGEX } from '@repona/core';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_VERIFIER_REGEX = /^[0-9a-f]{64}$/;

export type PendingVerifiedOperation = {
  operationId: string;
  verifier: string;
};
export type PendingDeleteOperation = { operationId: string; casaCode: string };
export type PendingTokenRotation = PendingVerifiedOperation & { casaCode: string };
export type PendingCreateAck =
  | { kind: 'verified'; operation: PendingVerifiedOperation }
  | { kind: 'legacy'; operationId: string };

function validVerifiedOperation(
  value: Partial<PendingVerifiedOperation>,
): value is PendingVerifiedOperation {
  return (
    typeof value.operationId === 'string' &&
    UUID_V4_REGEX.test(value.operationId) &&
    typeof value.verifier === 'string' &&
    OPERATION_VERIFIER_REGEX.test(value.verifier)
  );
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('CORRUPT_PENDING_OPERATION');
  }
}

export function verifierFromRandomBytes(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error('SECURE_RANDOM_UNAVAILABLE');
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hasPendingDeleteOperation(stored: string | null): boolean {
  // Mesmo corrompido pode representar request remoto que commitou ou ainda
  // está in-flight. Só a ação explícita de DELETE pode resolvê-lo.
  return stored !== null;
}

export function hasPendingTokenRotation(stored: string | null): boolean {
  return stored !== null;
}

export function resolveCreateOperation(
  stored: string | null,
  create: () => PendingVerifiedOperation,
): PendingVerifiedOperation {
  if (stored !== null) {
    const value = parseJson(stored);
    if (value && typeof value === 'object' && validVerifiedOperation(value)) return value;
    // Pode existir uma casa commitada cujo response se perdeu. Nunca substitui
    // um registro presente/corrompido por outra operação de CREATE.
    throw new Error('CORRUPT_PENDING_CREATE_OPERATION');
  }

  const created = create();
  if (!validVerifiedOperation(created)) throw new Error('INVALID_OPERATION_GENERATOR');
  return created;
}

export function pendingVerifiedOperationMatches(
  stored: string | null,
  expected: PendingVerifiedOperation,
): boolean {
  if (stored === null || !validVerifiedOperation(expected)) return false;
  try {
    const value = parseJson(stored);
    return Boolean(
      value &&
        typeof value === 'object' &&
        validVerifiedOperation(value) &&
        value.operationId === expected.operationId &&
        value.verifier === expected.verifier,
    );
  } catch {
    // Um registro corrompido pode representar uma resposta perdida. O ACK
    // nunca o substitui nem o apaga por aproximação.
    return false;
  }
}

export function parsePendingCreateAck(stored: string | null): PendingCreateAck | null {
  if (stored === null) return null;
  if (UUID_V4_REGEX.test(stored)) {
    // Builds antigos persistiam só UUID. É aceito exclusivamente depois que o
    // token+casaId já existem em pending-create; nunca recupera token do server.
    return { kind: 'legacy', operationId: stored };
  }
  const value = parseJson(stored);
  if (value && typeof value === 'object' && validVerifiedOperation(value)) {
    return { kind: 'verified', operation: value };
  }
  throw new Error('CORRUPT_PENDING_CREATE_OPERATION');
}

export function pendingCreateAckMatches(
  stored: string | null,
  expected: PendingCreateAck,
): boolean {
  return expected.kind === 'legacy'
    ? stored === expected.operationId
    : pendingVerifiedOperationMatches(stored, expected.operation);
}

export function resolveTokenRotationOperation(
  stored: string | null,
  casaCode: string,
  create: () => PendingVerifiedOperation,
): PendingTokenRotation {
  if (stored !== null) {
    const value = parseJson(stored);
    if (
      value &&
      typeof value === 'object' &&
      validVerifiedOperation(value) &&
      'casaCode' in value &&
      value.casaCode === casaCode
    ) {
      return { operationId: value.operationId, verifier: value.verifier, casaCode };
    }
    throw new Error('PENDING_ROTATION_CONFLICT');
  }
  const created = create();
  if (!validVerifiedOperation(created)) throw new Error('INVALID_OPERATION_GENERATOR');
  return { ...created, casaCode };
}

export function parseTokenRotationOperation(stored: string | null): PendingTokenRotation | null {
  if (stored === null) return null;
  const value = parseJson(stored);
  if (
    value &&
    typeof value === 'object' &&
    validVerifiedOperation(value) &&
    'casaCode' in value &&
    typeof value.casaCode === 'string' &&
    CASA_CODE_REGEX.test(value.casaCode)
  ) {
    return { operationId: value.operationId, verifier: value.verifier, casaCode: value.casaCode };
  }
  throw new Error('CORRUPT_PENDING_ROTATION');
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
