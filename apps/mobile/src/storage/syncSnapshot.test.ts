import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_LIMITS, MAX_PRICE_CENTS } from '@repona/core';
import { captureUnexpectedResult } from './resultBoundary';
import { parseSyncSnapshot } from './syncSnapshot';

const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ISO = '2026-07-21T12:34:56.789Z';

function validSnapshot() {
  return {
    products: [
      {
        syncId: UUID,
        updatedAt: ISO,
        metadataUpdatedAt: ISO,
        inventoryUpdatedAt: ISO,
        name: 'Arroz',
        category: 'Mercearia',
        brand: null,
        barcode: '7891234567890',
        purchaseCount: 2,
        status: 'active',
        alertThreshold: '1 un',
        inventoryQuantity: '2 un',
        inventoryStatus: 'in_stock',
        archived: false,
        occasional: true,
      },
    ],
    purchases: [
      {
        syncId: UUID,
        productName: 'Arroz',
        quantity: '1 un',
        purchasedAt: ISO,
        sourceListName: 'Mercado',
        deleted: false,
        updatedAt: ISO,
      },
    ],
    consumptions: [
      {
        syncId: UUID,
        eventType: 'consumed' as const,
        productName: 'Arroz',
        quantity: '1 un',
        occurredAt: ISO,
      },
    ],
    prices: [
      {
        syncId: UUID,
        productName: 'Arroz',
        priceCents: 1_299,
        recordedAt: ISO,
      },
    ],
    listItems: [
      {
        productName: 'Arroz',
        quantity: '1 un',
        checked: false,
        deleted: false,
        updatedAt: ISO,
      },
    ],
  };
}

test('parseSyncSnapshot aceita todos os campos válidos do applySnapshot', () => {
  const snapshot = validSnapshot();
  assert.equal(parseSyncSnapshot(snapshot), snapshot);

  const legacyBase = validSnapshot();
  const legacy = {
    ...legacyBase,
    products: [
      {
        ...legacyBase.products[0],
        syncId: undefined,
        updatedAt: undefined,
        metadataUpdatedAt: undefined,
        inventoryUpdatedAt: undefined,
      },
    ],
    purchases: [{ ...legacyBase.purchases[0], syncId: undefined }],
    consumptions: [{ ...legacyBase.consumptions[0], syncId: undefined }],
    prices: [{ ...legacyBase.prices[0], syncId: undefined }],
  };
  assert.equal(parseSyncSnapshot(legacy), legacy);

  const baselineSource = validSnapshot();
  const zeroBaseline = {
    ...baselineSource,
    consumptions: [
      {
        ...baselineSource.consumptions[0],
        eventType: 'set' as const,
        quantity: '0 un',
      },
    ],
  };
  assert.equal(parseSyncSnapshot(zeroBaseline), zeroBaseline);
});

test('parseSyncSnapshot rejeita barcode objeto e campos escalares com tipos errados', () => {
  const snapshot = validSnapshot();

  assert.equal(
    parseSyncSnapshot({
      ...snapshot,
      products: [{ ...snapshot.products[0], barcode: { value: '7891234567890' } }],
    }),
    null,
  );
  assert.equal(
    parseSyncSnapshot({
      ...snapshot,
      products: [{ ...snapshot.products[0], purchaseCount: '2' }],
    }),
    null,
  );
  assert.equal(
    parseSyncSnapshot({
      ...snapshot,
      prices: [{ ...snapshot.prices[0], priceCents: 12.5 }],
    }),
    null,
  );
});

test('parseSyncSnapshot exige booleanos reais, inclusive opcionais quando presentes', () => {
  const snapshot = validSnapshot();

  const malformed = [
    { ...snapshot, products: [{ ...snapshot.products[0], archived: 0 }] },
    { ...snapshot, products: [{ ...snapshot.products[0], occasional: 'false' }] },
    { ...snapshot, purchases: [{ ...snapshot.purchases[0], deleted: 'false' }] },
    { ...snapshot, listItems: [{ ...snapshot.listItems[0], checked: 1 }] },
    { ...snapshot, listItems: [{ ...snapshot.listItems[0], deleted: null }] },
  ];

  for (const raw of malformed) assert.equal(parseSyncSnapshot(raw), null);
});

test('parseSyncSnapshot rejeita datas inválidas em todos os grupos', () => {
  const mutations: Array<(snapshot: ReturnType<typeof validSnapshot>) => void> = [
    (snapshot) => {
      snapshot.products[0].updatedAt = 'ontem';
    },
    (snapshot) => {
      snapshot.products[0].metadataUpdatedAt = '2026-02-30T12:00:00Z';
    },
    (snapshot) => {
      snapshot.products[0].inventoryUpdatedAt = '2026-07-21';
    },
    (snapshot) => {
      snapshot.purchases[0].purchasedAt = '21/07/2026';
    },
    (snapshot) => {
      snapshot.purchases[0].updatedAt = '2026-07-21T25:00:00Z';
    },
    (snapshot) => {
      snapshot.consumptions[0].occurredAt = '';
    },
    (snapshot) => {
      snapshot.prices[0].recordedAt = '2026-07-21T12:00:00';
    },
    (snapshot) => {
      snapshot.listItems[0].updatedAt = 'invalid';
    },
  ];

  for (const mutate of mutations) {
    const snapshot = validSnapshot();
    mutate(snapshot);
    assert.equal(parseSyncSnapshot(snapshot), null);
  }
});

test('parseSyncSnapshot rejeita enums, UUIDs, quantidades e limites fora do contrato', () => {
  const snapshot = validSnapshot();
  const tooManyProducts = Array.from({ length: 2_001 }, () => snapshot.products[0]);

  const malformed = [
    { ...snapshot, products: [{ ...snapshot.products[0], category: 'Outros' }] },
    { ...snapshot, products: [{ ...snapshot.products[0], status: 'deleted' }] },
    { ...snapshot, products: [{ ...snapshot.products[0], inventoryStatus: 'full' }] },
    { ...snapshot, products: [{ ...snapshot.products[0], syncId: 'not-a-uuid' }] },
    { ...snapshot, products: [{ ...snapshot.products[0], name: 'x'.repeat(FIELD_LIMITS.name + 1) }] },
    { ...snapshot, products: [{ ...snapshot.products[0], inventoryQuantity: 'abc' }] },
    { ...snapshot, purchases: [{ ...snapshot.purchases[0], quantity: '0 un' }] },
    { ...snapshot, consumptions: [{ ...snapshot.consumptions[0], eventType: 'reset' }] },
    { ...snapshot, prices: [{ ...snapshot.prices[0], priceCents: MAX_PRICE_CENTS + 1 }] },
    { ...snapshot, products: tooManyProducts },
  ];

  for (const raw of malformed) assert.equal(parseSyncSnapshot(raw), null);
});

test('parseSyncSnapshot rejeita resposta sem as coleções obrigatórias', () => {
  assert.equal(parseSyncSnapshot(null), null);
  assert.equal(parseSyncSnapshot({}), null);
  assert.equal(
    parseSyncSnapshot({ products: [], purchases: [], consumptions: [], prices: {} }),
    null,
  );
});

test('captureUnexpectedResult converte rejeição inesperada em resultado tipado', async () => {
  const fallback = { ok: false as const, error: 'SERVER' as const };
  let observed = 0;
  const result = await captureUnexpectedResult(
    async () => {
      throw new Error('SecureStore/SQLite indisponível');
    },
    () => fallback,
    () => {
      observed += 1;
    },
  );

  assert.deepEqual(result, fallback);
  assert.equal(observed, 1);
  assert.deepEqual(
    await captureUnexpectedResult<{ ok: true } | typeof fallback>(
      async () => ({ ok: true }),
      () => fallback,
    ),
    { ok: true },
  );

  assert.deepEqual(
    await captureUnexpectedResult(
      async () => {
        throw new Error('falha local');
      },
      () => fallback,
      () => {
        throw new Error('sink indisponível');
      },
    ),
    fallback,
  );
});
