import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEmptyQuantity,
  getNextInventoryQuantity,
  getConsumedQuantity,
  normalizeQuantity,
  buildQuantityString,
  MAX_QUANTITY_VALUE,
} from "./inventory-quantity";

test("normalizeQuantity: caixa e espaços viram a mesma chave", () => {
  assert.equal(normalizeQuantity("1 un"), "1 un");
  assert.equal(normalizeQuantity("  1   Un "), "1 un");
  assert.equal(normalizeQuantity("1 UN"), "1 un");
  assert.equal(normalizeQuantity("500 G"), "500 g");
  // variações que NÃO unifica (documentado): sem espaço e sinônimo de unidade
  assert.notEqual(normalizeQuantity("1un"), normalizeQuantity("1 un"));
});

test("isEmptyQuantity", () => {
  assert.equal(isEmptyQuantity("0 un"), true);
  assert.equal(isEmptyQuantity("0,0 g"), true);
  assert.equal(isEmptyQuantity("1 un"), false);
  assert.equal(isEmptyQuantity("500 g"), false);
  // sem número no início: não considera vazio
  assert.equal(isEmptyQuantity("un"), false);
});

test("getNextInventoryQuantity: unidades", () => {
  assert.equal(getNextInventoryQuantity("1 un", 1), "2 un");
  assert.equal(getNextInventoryQuantity("2 un", -1), "1 un");
  // não desce abaixo de zero
  assert.equal(getNextInventoryQuantity("0 un", -1), "0 un");
});

test("getNextInventoryQuantity: gramas usam passo de 100", () => {
  assert.equal(getNextInventoryQuantity("500 g", 1), "600 g");
  assert.equal(getNextInventoryQuantity("500 g", -1), "400 g");
  assert.equal(getNextInventoryQuantity("50 g", -1), "0 g");
});

test("getNextInventoryQuantity: string inválida", () => {
  assert.equal(getNextInventoryQuantity("", 1), "1 un");
  assert.equal(getNextInventoryQuantity("", -1), "0 un");
});

test("buildQuantityString: monta forma canônica com vírgula", () => {
  assert.equal(buildQuantityString("2", "un"), "2 un");
  assert.equal(buildQuantityString("0,8", "kg"), "0,8 kg");
  assert.equal(buildQuantityString("0.8", "kg"), "0,8 kg");
  // unidade vazia cai para "un"
  assert.equal(buildQuantityString("3", ""), "3 un");
});

test("buildQuantityString: rejeita inválidos e notação científica (auditoria #30)", () => {
  assert.equal(buildQuantityString("0", "un"), null);
  assert.equal(buildQuantityString("-1", "un"), null);
  assert.equal(buildQuantityString("abc", "un"), null);
  // valor que viraria 1e+21 no String(num) — acima do teto, rejeitado
  assert.equal(buildQuantityString("1e21", "un"), null);
  assert.equal(buildQuantityString(String(MAX_QUANTITY_VALUE + 1), "un"), null);
  // o teto em si é aceito e não usa notação científica
  const noLimite = buildQuantityString(String(MAX_QUANTITY_VALUE), "un");
  assert.equal(noLimite, `${MAX_QUANTITY_VALUE} un`);
  assert.ok(!noLimite!.includes("e"));
});

test("getConsumedQuantity", () => {
  // consome 1 passo (un)
  assert.equal(getConsumedQuantity("3 un"), "1 un");
  // consome no máximo o disponível
  assert.equal(getConsumedQuantity("1 un"), "1 un");
  // gramas: passo de 100, limitado ao disponível
  assert.equal(getConsumedQuantity("250 g"), "100 g");
  assert.equal(getConsumedQuantity("50 g"), "50 g");
});
