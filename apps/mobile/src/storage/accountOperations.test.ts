import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasPendingDeleteOperation,
  hasPendingTokenRotation,
  pendingVerifiedOperationMatches,
  parseTokenRotationOperation,
  parsePendingCreateAck,
  pendingCreateAckMatches,
  resolveCreateOperation,
  resolveDeleteOperation,
  resolveTokenRotationOperation,
  verifierFromRandomBytes,
} from './accountOperations';

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
const VERIFIER_A = 'ab'.repeat(32);
const VERIFIER_B = 'cd'.repeat(32);

test('CREATE reutiliza id+verifier persistidos após resposta perdida', () => {
  const stored = JSON.stringify({ operationId: ID_A, verifier: VERIFIER_A });
  assert.deepEqual(resolveCreateOperation(stored, () => ({
    operationId: ID_B,
    verifier: VERIFIER_B,
  })), { operationId: ID_A, verifier: VERIFIER_A });
});

test('CREATE gera somente quando não há registro e falha fechado se corrompido', () => {
  assert.deepEqual(resolveCreateOperation(null, () => ({
    operationId: ID_B,
    verifier: VERIFIER_B,
  })), { operationId: ID_B, verifier: VERIFIER_B });
  assert.throws(
    () => resolveCreateOperation('{', () => ({ operationId: ID_B, verifier: VERIFIER_B })),
    /CORRUPT_PENDING_OPERATION/,
  );
  assert.throws(
    () => resolveCreateOperation(ID_A, () => ({ operationId: ID_B, verifier: VERIFIER_B })),
    /CORRUPT_PENDING_OPERATION/,
  );
});

test('pending-create já confirmado aceita marcador UUID legado só para ACK exato', () => {
  const ack = parsePendingCreateAck(ID_A);
  assert.deepEqual(ack, { kind: 'legacy', operationId: ID_A });
  assert.equal(pendingCreateAckMatches(ID_A, ack!), true);
  assert.equal(pendingCreateAckMatches(ID_B, ack!), false);
  assert.throws(() => resolveCreateOperation(ID_A, () => ({
    operationId: ID_B,
    verifier: VERIFIER_B,
  })), /CORRUPT_PENDING_OPERATION/);
});

test('ACK de CREATE limpa somente o registro id+verifier exato', () => {
  const expected = { operationId: ID_A, verifier: VERIFIER_A };
  assert.equal(pendingVerifiedOperationMatches(JSON.stringify(expected), expected), true);
  assert.equal(
    pendingVerifiedOperationMatches(
      JSON.stringify({ operationId: ID_B, verifier: VERIFIER_A }),
      expected,
    ),
    false,
  );
  assert.equal(
    pendingVerifiedOperationMatches(
      JSON.stringify({ operationId: ID_A, verifier: VERIFIER_B }),
      expected,
    ),
    false,
  );
  assert.equal(pendingVerifiedOperationMatches('{', expected), false);
  assert.equal(pendingVerifiedOperationMatches(null, expected), false);
});

test('verifier exige exatamente 32 bytes criptográficos', () => {
  assert.equal(verifierFromRandomBytes(new Uint8Array(32).fill(171)), VERIFIER_A);
  assert.throws(() => verifierFromRandomBytes(new Uint8Array(16)), /SECURE_RANDOM_UNAVAILABLE/);
});

test('rotação reutiliza somente id+verifier ligados ao mesmo token', () => {
  const codeA = '2'.repeat(12);
  const codeB = '3'.repeat(12);
  const raw = JSON.stringify({ operationId: ID_A, verifier: VERIFIER_A, casaCode: codeA });
  assert.deepEqual(resolveTokenRotationOperation(raw, codeA, () => ({
    operationId: ID_B,
    verifier: VERIFIER_B,
  })), { operationId: ID_A, verifier: VERIFIER_A, casaCode: codeA });
  assert.throws(
    () => resolveTokenRotationOperation(raw, codeB, () => ({
      operationId: ID_B,
      verifier: VERIFIER_B,
    })),
    /PENDING_ROTATION_CONFLICT/,
  );
  assert.deepEqual(parseTokenRotationOperation(raw), {
    operationId: ID_A,
    verifier: VERIFIER_A,
    casaCode: codeA,
  });
});

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

test('DELETE pendente bloqueia outras mutações mesmo se o registro corrompeu', () => {
  assert.equal(hasPendingDeleteOperation(null), false);
  assert.equal(hasPendingDeleteOperation('{'), true);
});

test('rotação pendente bloqueia unpair mesmo se a resposta se perdeu', () => {
  assert.equal(hasPendingTokenRotation(null), false);
  assert.equal(hasPendingTokenRotation('{'), true);
});
