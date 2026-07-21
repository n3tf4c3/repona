import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPurchaseHistoryKeyWindow,
  groupPurchaseHistoryRecords,
  isPurchaseHistoryKeyAfterCursor,
  mergeHistoryGroups,
  normalizePurchaseHistoryCursor,
  normalizePurchaseHistoryLimit,
  type PurchaseHistoryKey,
} from './purchaseHistoryPagination';

const keys: PurchaseHistoryKey[] = [
  { purchasedAt: '2026-07-21T12:00:00.000Z', sourceNameKey: 'Feira' },
  { purchasedAt: '2026-07-21T12:00:00.000Z', sourceNameKey: 'Mercado' },
  { purchasedAt: '2026-07-20T12:00:00.000Z', sourceNameKey: '' },
  { purchasedAt: '2026-07-19T12:00:00.000Z', sourceNameKey: 'Atacado' },
];

test('pagina chaves de compras sem repetir ou dividir uma compra', () => {
  const first = createPurchaseHistoryKeyWindow(keys.slice(0, 3), 2);
  assert.deepEqual(first.keys, keys.slice(0, 2));
  assert.deepEqual(first.nextCursor, keys[1]);

  const remaining = keys.filter((key) =>
    isPurchaseHistoryKeyAfterCursor(key, first.nextCursor!),
  );
  const second = createPurchaseHistoryKeyWindow(remaining, 2);
  assert.deepEqual(second.keys, keys.slice(2));
  assert.equal(second.nextCursor, null);
});

test('cursor usa o nome como desempate quando a data é igual', () => {
  assert.equal(isPurchaseHistoryKeyAfterCursor(keys[0], keys[0]), false);
  assert.equal(isPurchaseHistoryKeyAfterCursor(keys[1], keys[0]), true);
  assert.equal(isPurchaseHistoryKeyAfterCursor(keys[2], keys[1]), true);
});

test('normaliza limites e rejeita cursores inválidos', () => {
  assert.equal(normalizePurchaseHistoryLimit(0), 1);
  assert.equal(normalizePurchaseHistoryLimit(10_000), 50);
  assert.equal(normalizePurchaseHistoryLimit(Number.NaN), 20);
  assert.equal(
    normalizePurchaseHistoryCursor({ purchasedAt: 'inválida', sourceNameKey: 'Lista' }),
    null,
  );
  assert.deepEqual(
    normalizePurchaseHistoryCursor({
      purchasedAt: '2026-07-21T12:00:00Z',
      sourceNameKey: 'Lista',
    }),
    { purchasedAt: '2026-07-21T12:00:00Z', sourceNameKey: 'Lista' },
  );
});

test('agrupa linhas por compra e mescla páginas sem duplicar cartões', () => {
  const grouped = groupPurchaseHistoryRecords([
    { id: 1, purchasedAt: keys[0].purchasedAt, sourceListName: 'Feira' },
    { id: 2, purchasedAt: keys[0].purchasedAt, sourceListName: 'Feira' },
    { id: 3, purchasedAt: keys[0].purchasedAt, sourceListName: 'Mercado' },
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].records.length, 2);

  const first = [{ title: 'Julho', items: [{ id: 'feira' }] }];
  const second = [{ title: 'Julho', items: [{ id: 'mercado' }] }];
  const merged = mergeHistoryGroups(first, second);
  assert.deepEqual(merged[0].items.map((item) => item.id), ['feira', 'mercado']);
  assert.equal(mergeHistoryGroups(merged, second)[0].items.length, 2);
});
