const PREFIX = "repona:pending-operation:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OperationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function getOrCreateOperationId(
  key: string,
  storage: OperationStorage,
  createUuid: () => string
): string {
  const storageKey = `${PREFIX}${key}`;
  const stored = storage.getItem(storageKey);
  if (stored && UUID_RE.test(stored)) return stored;
  const operationId = createUuid();
  if (!UUID_RE.test(operationId)) throw new Error("INVALID_OPERATION_ID_GENERATOR");
  storage.setItem(storageKey, operationId);
  return operationId;
}

export function clearOperationId(key: string, storage: OperationStorage): void {
  storage.removeItem(`${PREFIX}${key}`);
}

export function readOperationId(key: string, storage: OperationStorage): string | null {
  const stored = storage.getItem(`${PREFIX}${key}`);
  return stored && UUID_RE.test(stored) ? stored : null;
}
