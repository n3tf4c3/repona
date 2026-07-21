import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCreateOperationId, resolveDeleteOperation } from './accountOperations';

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';

test('CREATE reutiliza a chave persistida após resposta perdida', () => {
  assert.equal(resolveCreateOperationId(ID_A, () => ID_B), ID_A);
  assert.equal(resolveCreateOperationId(null, () => ID_B), ID_B);
});

test('DELETE reutiliza a chave apenas para a mesma conta', () => {
  const stored = JSON.stringify({ operationId: ID_A, casaCode: 'TOKEN-A' });
  assert.deepEqual(resolveDeleteOperation(stored, 'TOKEN-A', () => ID_B), {
    operationId: ID_A,
    casaCode: 'TOKEN-A',
  });
  assert.deepEqual(resolveDeleteOperation(stored, 'TOKEN-B', () => ID_B), {
    operationId: ID_B,
    casaCode: 'TOKEN-B',
  });
});

test('estado corrompido nunca é enviado como Idempotency-Key', () => {
  assert.equal(resolveCreateOperationId('quebrado', () => ID_A), ID_A);
  assert.deepEqual(resolveDeleteOperation('{', 'TOKEN-A', () => ID_B), {
    operationId: ID_B,
    casaCode: 'TOKEN-A',
  });
});

