export type MigrationState =
  | { kind: 'binding'; binding: { code: string; casaId: number } }
  | { kind: 'pending-create'; binding: { code: string; casaId: number } }
  | { kind: 'pending-pair'; code: string; casaId?: number }
  | { kind: 'legacy-unverified'; code: string; casaId: number }
  | { kind: 'legacy-unbound'; code: string }
  | { kind: 'pending-create-request' }
  | { kind: 'none' };

export type MigrationPromotionPlan =
  | { kind: 'persist-binding' }
  | { kind: 'persist-pending-create' }
  | { kind: 'persist-pull-only' }
  | { kind: 'already-durable' }
  | { kind: 'conflict' };

export function planTokenMigrationPromotion(
  state: MigrationState,
  oldCode: string,
  result: { token: string; casaId: number },
): MigrationPromotionPlan {
  if (state.kind === 'binding') {
    if (state.binding.casaId !== result.casaId) return { kind: 'conflict' };
    if (state.binding.code === result.token) return { kind: 'already-durable' };
    return state.binding.code === oldCode
      ? { kind: 'persist-binding' }
      : { kind: 'conflict' };
  }
  if (state.kind === 'pending-create') {
    if (state.binding.casaId !== result.casaId) return { kind: 'conflict' };
    if (state.binding.code === result.token) return { kind: 'already-durable' };
    return state.binding.code === oldCode
      ? { kind: 'persist-pending-create' }
      : { kind: 'conflict' };
  }
  if (
    state.kind === 'legacy-unverified' ||
    state.kind === 'legacy-unbound' ||
    state.kind === 'pending-pair'
  ) {
    if (state.code === result.token) {
      return state.kind === 'pending-pair' &&
        state.casaId !== undefined &&
        state.casaId !== result.casaId
        ? { kind: 'conflict' }
        : { kind: 'already-durable' };
    }
    if (state.code !== oldCode) return { kind: 'conflict' };
    if (
      state.kind === 'pending-pair' &&
      state.casaId !== undefined &&
      state.casaId !== result.casaId
    ) {
      return { kind: 'conflict' };
    }
    // legacy-unverified nunca é upload/binding: seu casaId antigo não era uma
    // escrita atômica com o token e não prova a identidade do SQLite.
    return { kind: 'persist-pull-only' };
  }
  return { kind: 'conflict' };
}
