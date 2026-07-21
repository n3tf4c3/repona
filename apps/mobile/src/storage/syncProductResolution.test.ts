import assert from 'node:assert/strict';
import test from 'node:test';
import { productNameKey } from '@repona/core';
import {
  assertLocalSyncProductReferencesResolved,
  localProductIdForSyncEntry,
  UnknownLocalSyncProductError,
} from './syncProductResolution';

test('referência resolve por syncId e cai para nome NFC', () => {
  const names = new Map([[productNameKey('Café'), 7]]);
  const ids = new Map([['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 8]]);
  assert.equal(
    localProductIdForSyncEntry(
      { productSyncId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', productName: 'outro' },
      names,
      ids,
    ),
    8,
  );
  assert.equal(localProductIdForSyncEntry({ productName: 'Cafe\u0301' }, names, ids), 7);
});

test('página remota com produto desconhecido falha antes de avançar a sessão', () => {
  assert.throws(
    () =>
      assertLocalSyncProductReferencesResolved(
        [{ productSyncId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', productName: 'Ausente' }],
        new Map(),
        new Map(),
      ),
    UnknownLocalSyncProductError,
  );
});
