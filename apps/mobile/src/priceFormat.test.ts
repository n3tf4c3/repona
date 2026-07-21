import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PRICE_CENTS } from '@repona/core';
import { formatCentsBRL, parsePriceToCents } from './priceFormat';

test('formatCentsBRL: centavos -> BRL', () => {
  assert.equal(formatCentsBRL(0), 'R$ 0,00');
  assert.equal(formatCentsBRL(890), 'R$ 8,90');
  assert.equal(formatCentsBRL(1599), 'R$ 15,99');
});

test('parsePriceToCents: aceita virgula, ponto e inteiro', () => {
  assert.equal(parsePriceToCents('8,90'), 890);
  assert.equal(parsePriceToCents('8.90'), 890);
  assert.equal(parsePriceToCents('12'), 1200);
  assert.equal(parsePriceToCents(' 8,90 '), 890);
});

test('parsePriceToCents: rejeita vazio, invalido e nao-positivo', () => {
  assert.equal(parsePriceToCents(''), null);
  assert.equal(parsePriceToCents('abc'), null);
  assert.equal(parsePriceToCents('0'), null);
  assert.equal(parsePriceToCents('-5'), null);
});

test('parsePriceToCents: rejeita acima do teto do sync (auditoria #29)', () => {
  const noTeto = parsePriceToCents(String(MAX_PRICE_CENTS / 100));
  assert.equal(noTeto, MAX_PRICE_CENTS);
  assert.equal(parsePriceToCents(String(MAX_PRICE_CENTS / 100 + 1000)), null);
});
