import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCreateAccountAction,
  resolvePairAccountAction,
  resolveUnpairAccountAction,
  type AccountCredentialState,
} from './accountFlowState';

const CODE_A = 'AAAAAAAAAAAAAAAA';
const CODE_B = 'BBBBBBBBBBBBBBBB';

test('create inicia apenas sem credencial e retoma o pending-create existente', () => {
  assert.deepEqual(resolveCreateAccountAction({ kind: 'none' }), { kind: 'start' });
  assert.deepEqual(
    resolveCreateAccountAction({
      kind: 'pending-create',
      binding: { code: CODE_A, casaId: 41 },
    }),
    { kind: 'resume', code: CODE_A, casaId: 41 },
  );
});

test('create recusa binding, pending-pair e credenciais legadas', () => {
  const states: AccountCredentialState[] = [
    { kind: 'binding' },
    { kind: 'pending-pair', code: CODE_A },
    { kind: 'legacy-unverified' },
    { kind: 'legacy-unbound' },
  ];

  for (const state of states) {
    assert.deepEqual(resolveCreateAccountAction(state), { kind: 'reject' });
  }
});

test('pair inicia sem credencial e retoma apenas o mesmo pending-pair', () => {
  assert.deepEqual(resolvePairAccountAction({ kind: 'none' }, CODE_A), { kind: 'start' });
  assert.deepEqual(
    resolvePairAccountAction({ kind: 'pending-pair', code: CODE_A, casaId: 73 }, CODE_A),
    { kind: 'resume', casaId: 73 },
  );
  assert.deepEqual(
    resolvePairAccountAction({ kind: 'pending-pair', code: CODE_A }, CODE_A),
    { kind: 'resume' },
  );
  assert.deepEqual(
    resolvePairAccountAction({ kind: 'pending-pair', code: CODE_A }, CODE_B),
    { kind: 'reject' },
  );
});

test('pair recusa binding, pending-create e credenciais legadas', () => {
  const states: AccountCredentialState[] = [
    { kind: 'binding' },
    { kind: 'pending-create', binding: { code: CODE_A, casaId: 41 } },
    { kind: 'legacy-unverified' },
    { kind: 'legacy-unbound' },
  ];

  for (const state of states) {
    assert.deepEqual(resolvePairAccountAction(state, CODE_A), { kind: 'reject' });
  }
});

test('desconexão explícita não pode abandonar CREATE ainda recuperável', () => {
  assert.deepEqual(
    resolveUnpairAccountAction({
      kind: 'pending-create',
      binding: { code: CODE_A, casaId: 41 },
    }),
    { kind: 'reject' },
  );
  assert.deepEqual(resolveUnpairAccountAction({ kind: 'binding' }), { kind: 'proceed' });
  assert.deepEqual(resolveUnpairAccountAction({ kind: 'pending-pair', code: CODE_A }), {
    kind: 'proceed',
  });
});
