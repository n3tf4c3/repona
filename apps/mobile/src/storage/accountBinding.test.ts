import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAccountBinding,
  parsePendingCreateBinding,
  serializeAccountBinding,
} from './accountBinding';

const code = 'ABCDEFGHJKMNPQRSTVWXYZ2345';

test('vínculo conta-arquivo faz round-trip em um único valor', () => {
  const serialized = serializeAccountBinding(code, 42);
  assert.deepEqual(parseAccountBinding(serialized), { version: 1, code, casaId: 42 });
  assert.deepEqual(parsePendingCreateBinding(serialized), { version: 1, code, casaId: 42 });
});

test('vínculo inválido nunca escolhe arquivo nem credencial', () => {
  assert.equal(parseAccountBinding(null), null);
  assert.equal(parseAccountBinding('{'), null);
  assert.equal(parseAccountBinding(JSON.stringify({ version: 1, code, casaId: 0 })), null);
  assert.equal(
    parseAccountBinding(JSON.stringify({ version: 2, code, casaId: 42 })),
    null,
  );
});
