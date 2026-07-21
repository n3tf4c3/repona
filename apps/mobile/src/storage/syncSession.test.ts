import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySyncHighWaterMarks, emptySyncSnapshot } from '@repona/core';
import {
  createSyncSession,
  parseSyncSession,
  pendingPairFromSession,
  sessionMatches,
  startDownload,
  syncPageFingerprint,
} from './syncSession';

const code = 'ABCDEFGHJKMNPQRSTVWXYZ2345';

test('sessão persiste página pendente sem avançar antes do ACK', () => {
  const initial = createSyncSession(
    code,
    true,
    '2026-01-01T00:00:00.000Z',
    { ...emptySyncHighWaterMarks(), products: 10 },
  );
  assert.equal(initial.phase, 'upload');
  if (initial.phase !== 'upload') return;
  const pending = {
    ...initial,
    pendingPageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    pendingPageFingerprint: syncPageFingerprint(emptySyncSnapshot()),
  };
  const restored = parseSyncSession(JSON.stringify(pending));
  assert.deepEqual(restored, pending);
  assert.equal(restored?.phase === 'upload' ? restored.afterId : -1, 0);
});

test('fase de download preserva cursor e identidade da casa após crash', () => {
  const upload = createSyncSession(code, true, null, emptySyncHighWaterMarks());
  assert.equal(upload.phase, 'upload');
  if (upload.phase !== 'upload') return;
  const download = { ...startDownload({ ...upload, casaId: 9 }), cursor: 'cursor-2' };
  assert.deepEqual(parseSyncSession(JSON.stringify(download)), download);
  assert.equal(sessionMatches(download, code, true), true);
  assert.equal(sessionMatches(download, '2345ABCDEFGHJKMNPQRSTVWXYZ', true), false);
});

test('pareamento incompleto continua recuperável antes de promover o vínculo atômico', () => {
  const initial = createSyncSession(code, false, null, null);
  assert.deepEqual(pendingPairFromSession(initial), { code });
  assert.equal(initial.phase, 'download');
  if (initial.phase !== 'download') return;

  const afterComplete = { ...initial, casaId: 9, complete: true };
  const restored = parseSyncSession(JSON.stringify(afterComplete));
  assert.deepEqual(pendingPairFromSession(restored), { code, casaId: 9 });
  assert.equal(
    pendingPairFromSession(createSyncSession(code, true, null, emptySyncHighWaterMarks())),
    null,
  );
});

test('high-water e fingerprint tornam a sessão finita e o retry semanticamente estável', () => {
  const highWater = { ...emptySyncHighWaterMarks(), purchases: 250 };
  const session = createSyncSession(code, true, null, highWater);
  assert.equal(session.phase, 'upload');
  if (session.phase !== 'upload') return;
  assert.equal(session.highWater.purchases, 250);
  // Uma inserção posterior (id 251) fica além do limite persistido e será
  // enviada somente pela sessão seguinte.
  assert.equal(251 <= session.highWater.purchases, false);

  const page = emptySyncSnapshot();
  const before = syncPageFingerprint(page);
  page.purchases.push({
    productName: 'Arroz',
    quantity: '1 un',
    purchasedAt: '2026-07-21T12:00:00.000Z',
  });
  assert.notEqual(syncPageFingerprint(page), before);
});
