import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completePendingLocalDelete,
  parsePendingLocalDelete,
  serializePendingLocalDelete,
  verifiedCasaIdForDelete,
} from './accountDeletion';

test('marcador de delete local é versionado e estrito', () => {
  assert.deepEqual(parsePendingLocalDelete(serializePendingLocalDelete(7)), {
    version: 1,
    casaId: 7,
  });
  assert.equal(parsePendingLocalDelete('{"version":1,"casaId":0}'), null);
  assert.equal(parsePendingLocalDelete('inválido'), null);
});

test('delete nunca usa casaId legado não verificado para escolher arquivo', () => {
  assert.equal(verifiedCasaIdForDelete({ kind: 'legacy-unverified', casaId: 9 }), null);
  assert.equal(verifiedCasaIdForDelete({ kind: 'binding', casaId: 9 }), 9);
  assert.equal(verifiedCasaIdForDelete({ kind: 'pending-pair', casaId: 9 }), 9);
});

test('cleanup é retomável depois de crash em cada fronteira', async () => {
  for (let crashAfter = 0; crashAfter < 4; crashAfter += 1) {
    const state = { scope: 'house', database: true, credentials: true, pending: true };
    let step = 0;
    let crashEnabled = true;
    const afterStep = () => {
      if (crashEnabled && step++ === crashAfter) throw new Error('CRASH');
    };
    const actions = {
      switchToLocal: async () => {
        state.scope = 'local';
        afterStep();
      },
      deleteDatabase: async () => {
        state.database = false;
        afterStep();
      },
      clearCredentials: async () => {
        state.credentials = false;
        afterStep();
      },
      clearPending: async () => {
        state.pending = false;
        afterStep();
      },
    };

    await assert.rejects(
      completePendingLocalDelete({ version: 1, casaId: 7 }, actions),
      /CRASH/,
    );
    crashEnabled = false;
    await completePendingLocalDelete({ version: 1, casaId: 7 }, actions);
    assert.deepEqual(state, {
      scope: 'local',
      database: false,
      credentials: false,
      pending: false,
    });
  }
});
