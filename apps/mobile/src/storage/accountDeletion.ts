const VERSION = 1 as const;

export type PendingLocalDelete = {
  version: typeof VERSION;
  casaId: number;
};

export function verifiedCasaIdForDelete(state: {
  kind: 'binding' | 'pending-create' | 'pending-pair' | 'legacy-unverified' | 'other';
  casaId?: number;
}): number | null {
  // Os dois valores legados eram gravados separadamente e podem ser de gerações
  // distintas; jamais usamos esse casaId para escolher qual arquivo apagar.
  if (state.kind === 'legacy-unverified' || state.kind === 'other') return null;
  return typeof state.casaId === 'number' && Number.isSafeInteger(state.casaId) && state.casaId > 0
    ? state.casaId
    : null;
}

export function serializePendingLocalDelete(casaId: number): string {
  if (!Number.isSafeInteger(casaId) || casaId <= 0) throw new Error('INVALID_CASA_ID');
  return JSON.stringify({ version: VERSION, casaId });
}

export function parsePendingLocalDelete(raw: string | null): PendingLocalDelete | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return value.version === VERSION &&
      typeof value.casaId === 'number' &&
      Number.isSafeInteger(value.casaId) &&
      value.casaId > 0
      ? { version: VERSION, casaId: value.casaId }
      : null;
  } catch {
    return null;
  }
}

export type LocalDeleteActions = {
  switchToLocal(): Promise<void>;
  deleteDatabase(casaId: number): Promise<void>;
  clearCredentials(): Promise<void>;
  clearPending(): Promise<void>;
};

// Cada passo é idempotente e o marcador só some por último. Assim qualquer
// crash reinicia no boot e nunca reabre um arquivo cuja conta já foi apagada.
export async function completePendingLocalDelete(
  pending: PendingLocalDelete,
  actions: LocalDeleteActions,
): Promise<void> {
  await actions.switchToLocal();
  await actions.deleteDatabase(pending.casaId);
  await actions.clearCredentials();
  await actions.clearPending();
}
