export type AccountCredentialState =
  | { kind: 'none' }
  | { kind: 'binding' }
  | { kind: 'pending-create'; binding: { code: string; casaId: number } }
  | { kind: 'pending-pair'; code: string; casaId?: number }
  | { kind: 'legacy-unverified' }
  | { kind: 'legacy-unbound' };

export type CreateAccountAction =
  | { kind: 'start' }
  | { kind: 'resume'; code: string; casaId: number }
  | { kind: 'reject' };

export type PairAccountAction =
  | { kind: 'start' }
  | { kind: 'resume'; casaId?: number }
  | { kind: 'reject' };

// A credencial persistida e a intencao duravel sempre vencem uma nova acao da
// UI. Isso impede que um retry crie outra casa ou troque silenciosamente o token.
export function resolveCreateAccountAction(
  state: AccountCredentialState,
): CreateAccountAction {
  if (state.kind === 'none') return { kind: 'start' };
  if (state.kind === 'pending-create') {
    return {
      kind: 'resume',
      code: state.binding.code,
      casaId: state.binding.casaId,
    };
  }
  return { kind: 'reject' };
}

export function resolvePairAccountAction(
  state: AccountCredentialState,
  code: string,
): PairAccountAction {
  if (state.kind === 'none') return { kind: 'start' };
  if (state.kind === 'pending-pair' && state.code === code) {
    return state.casaId === undefined
      ? { kind: 'resume' }
      : { kind: 'resume', casaId: state.casaId };
  }
  return { kind: 'reject' };
}
