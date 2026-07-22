import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPendingDeleteOperation,
  resolveDeleteOperation,
} from './accountOperations';

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';

test('DELETE reutiliza a chave apenas para a mesma conta e falha fechado', () => {
  const stored = JSON.stringify({ operationId: ID_A, casaCode: 'TOKEN-A' });
  assert.deepEqual(resolveDeleteOperation(stored, 'TOKEN-A', () => ID_B), {
    operationId: ID_A,
    casaCode: 'TOKEN-A',
  });
  assert.throws(
    () => resolveDeleteOperation(stored, 'TOKEN-B', () => ID_B),
    /PENDING_DELETE_CONFLICT/,
  );
});

test('DELETE gera nova chave quando não há registro', () => {
  assert.deepEqual(resolveDeleteOperation(null, 'TOKEN-A', () => ID_B), {
    operationId: ID_B,
    casaCode: 'TOKEN-A',
  });
});

test('DELETE pendente bloqueia outras mutações mesmo se o registro corrompeu', () => {
  assert.equal(hasPendingDeleteOperation(null), false);
  assert.equal(hasPendingDeleteOperation('{'), true);
});
