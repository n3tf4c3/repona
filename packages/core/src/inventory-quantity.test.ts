import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEmptyQuantity,
  getNextInventoryQuantity,
  getConsumedQuantity,
  normalizeQuantity,
  buildQuantityString,
  canonicalQuantity,
  MAX_QUANTITY_VALUE,
} from "./inventory-quantity";

test("canonicalQuantity: valor válido passa, inválido cai no fallback (auditoria #75)", () => {
  assert.equal(canonicalQuantity("500 g", "0 un"), "500 g");
  assert.equal(canonicalQuantity("0,8 kg", "1 un"), "0,8 kg");
  assert.equal(canonicalQuantity("", "0 un"), "0 un");
  assert.equal(canonicalQuantity("abc", "1 un"), "1 un");
  assert.equal(canonicalQuantity("   ", "0 un"), "0 un");
  // Match precisa ser integral: número sem unidade ou com lixo depois não passa.
  assert.equal(canonicalQuantity("5", "1 un"), "1 un");
  assert.equal(canonicalQuantity("1 ???", "1 un"), "1 un");
  assert.equal(canonicalQuantity("1 un lixo", "1 un"), "1 un");
  // Teto: acima de MAX_QUANTITY_VALUE cai no fallback.
  assert.equal(canonicalQuantity(`${MAX_QUANTITY_VALUE + 1} un`, "1 un"), "1 un");
  assert.equal(canonicalQuantity(`${MAX_QUANTITY_VALUE} un`, "1 un"), `${MAX_QUANTITY_VALUE} un`);
});

test("canonicalQuantity: positividade é contextual — estoque aceita zero, compra/consumo não (auditoria #75)", () => {
  // Sem allowZero (compra, consumo, item de lista): zero cai no fallback positivo.
  assert.equal(canonicalQuantity("0 un", "1 un"), "1 un");
  assert.equal(canonicalQuantity("0,0 kg", "1 un"), "1 un");
  // Com allowZero (estoque): zero é preservado.
  assert.equal(canonicalQuantity("0 un", "0 un", { allowZero: true }), "0 un");
  assert.equal(canonicalQuantity("500 g", "0 un", { allowZero: true }), "500 g");
});

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
