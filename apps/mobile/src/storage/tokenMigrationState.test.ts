import assert from 'node:assert/strict';
import test from 'node:test';
import { planTokenMigrationPromotion } from './tokenMigrationState';

const OLD = '2'.repeat(12);
const CURRENT = 'A'.repeat(26);

test('legacy-unverified sempre vira pull-only, nunca upload do scratch', () => {
  assert.deepEqual(
    planTokenMigrationPromotion(
      { kind: 'legacy-unverified', code: OLD, casaId: 999 },
      OLD,
      { token: CURRENT, casaId: 7 },
    ),
    { kind: 'persist-pull-only' },
  );
});

test('pending-create legado preserva upload e troca só o pending binding', () => {
  assert.deepEqual(
    planTokenMigrationPromotion(
      { kind: 'pending-create', binding: { code: OLD, casaId: 7 } },
      OLD,
      { token: CURRENT, casaId: 7 },
    ),
    { kind: 'persist-pending-create' },
  );
});

test('crash após salvar sessão nova reconhece promoção e permite ACK idempotente', () => {
  assert.deepEqual(
    planTokenMigrationPromotion(
      { kind: 'pending-pair', code: CURRENT, casaId: 7 },
      OLD,
      { token: CURRENT, casaId: 7 },
    ),
    { kind: 'already-durable' },
  );
});

test('casaId divergente nunca troca binding nem ACK', () => {
  assert.deepEqual(
    planTokenMigrationPromotion(
      { kind: 'binding', binding: { code: OLD, casaId: 8 } },
      OLD,
      { token: CURRENT, casaId: 7 },
    ),
    { kind: 'conflict' },
  );
});
