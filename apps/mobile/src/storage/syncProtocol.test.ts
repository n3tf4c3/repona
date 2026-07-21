import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySyncSnapshot } from '@repona/core';
import {
  classifySyncV2HttpFailure,
  parseLegacySyncResponse,
  parseSyncV2DownloadResponse,
  parseSyncV2UploadResponse,
} from './syncProtocol';

const pageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const base = {
  protocolVersion: 2,
  casaId: 7,
  serverTime: '2026-07-21T12:00:00.000Z',
};

test('ACK v2 precisa corresponder exatamente à página enviada', () => {
  assert.deepEqual(
    parseSyncV2UploadResponse({ ...base, phase: 'upload', ackPageId: pageId }, pageId),
    { casaId: 7, ackPageId: pageId },
  );
  assert.equal(
    parseSyncV2UploadResponse(
      { ...base, phase: 'upload', ackPageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      pageId,
    ),
    null,
  );
});

test('download v2 valida envelope, cursor e página antes de tocar SQLite', () => {
  const valid = {
    ...base,
    phase: 'download',
    page: emptySyncSnapshot(),
    collection: null,
    nextCursor: null,
  };
  assert.deepEqual(parseSyncV2DownloadResponse(valid), {
    casaId: 7,
    page: emptySyncSnapshot(),
    collection: null,
    nextCursor: null,
  });
  assert.equal(parseSyncV2DownloadResponse({ ...valid, protocolVersion: 1 }), null);
  assert.equal(parseSyncV2DownloadResponse({ ...valid, nextCursor: 'x'.repeat(257) }), null);
  assert.equal(parseSyncV2DownloadResponse({ ...valid, page: { products: [] } }), null);

  const wrongCollection = emptySyncSnapshot();
  wrongCollection.prices.push({
    productName: 'Arroz',
    priceCents: 100,
    recordedAt: '2026-07-21T12:00:00.000Z',
  });
  assert.equal(
    parseSyncV2DownloadResponse({
      ...valid,
      collection: 'products',
      nextCursor: 'next',
      page: wrongCollection,
    }),
    null,
  );
});

test('404 sem header negocia v1; 404 autenticado pela rota v2 preserva CASA_NOT_FOUND', () => {
  assert.equal(classifySyncV2HttpFailure(404, false, null), 'UNSUPPORTED_PROTOCOL');
  assert.equal(classifySyncV2HttpFailure(404, false, '2'), 'CASA_NOT_FOUND');
  assert.equal(classifySyncV2HttpFailure(413, false, '2'), 'SYNC_LIMIT');
  assert.equal(classifySyncV2HttpFailure(200, true, '2'), null);
});

test('resposta legada exige casaId e snapshot completos', () => {
  const raw = { ...emptySyncSnapshot(), casaId: 7 };
  assert.deepEqual(parseLegacySyncResponse(raw), {
    casaId: 7,
    snapshot: raw,
  });
  assert.equal(parseLegacySyncResponse({ ...emptySyncSnapshot(), casaId: 0 }), null);
  assert.equal(parseLegacySyncResponse({ products: [], casaId: 7 }), null);
});
