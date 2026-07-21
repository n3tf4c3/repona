import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EVENT_UPLOAD_WINDOW_MS,
  shouldUploadPurchaseAfterCutoff,
  syncEventCutoffIso,
} from './syncCutoff';

const nowMs = Date.parse('2026-07-21T12:00:00.000Z');

test('primeira sync ou estado inválido não filtra eventos', () => {
  assert.equal(syncEventCutoffIso(null, nowMs), null);
  assert.equal(syncEventCutoffIso('inválido', nowMs), null);
});

test('sync recente mantém a janela móvel de aproximadamente 24 meses', () => {
  assert.equal(
    syncEventCutoffIso('2026-07-20T12:00:00.000Z', nowMs),
    new Date(nowMs - EVENT_UPLOAD_WINDOW_MS).toISOString(),
  );
});

test('mais de 24 meses offline preserva todo evento posterior ao último ACK', () => {
  const previousSync = '2024-01-10T09:30:00.000Z';
  assert.equal(syncEventCutoffIso(previousSync, nowMs), previousSync);
  const offlineEvent = '2024-02-01T08:00:00.000Z';
  assert.ok(Date.parse(offlineEvent) >= Date.parse(syncEventCutoffIso(previousSync, nowMs)!));
});

test('compra antiga reincluída após o ACK sobe pelo updated_at novo', () => {
  const cutoffIso = '2024-07-21T12:00:00.000Z';
  assert.equal(
    shouldUploadPurchaseAfterCutoff(
      {
        purchasedAt: '2023-01-10T09:00:00.000Z',
        updatedAt: '2026-07-21T11:00:00.000Z',
        deleted: false,
      },
      cutoffIso,
    ),
    true,
  );
  assert.equal(
    shouldUploadPurchaseAfterCutoff(
      {
        purchasedAt: '2023-01-10T09:00:00.000Z',
        updatedAt: '2023-01-11T09:00:00.000Z',
        deleted: false,
      },
      cutoffIso,
    ),
    false,
  );
});
