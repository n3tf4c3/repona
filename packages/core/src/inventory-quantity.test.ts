import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEmptyQuantity,
  getNextInventoryQuantity,
  getConsumedQuantity,
} from "./inventory-quantity";

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

test("getConsumedQuantity", () => {
  // consome 1 passo (un)
  assert.equal(getConsumedQuantity("3 un"), "1 un");
  // consome no máximo o disponível
  assert.equal(getConsumedQuantity("1 un"), "1 un");
  // gramas: passo de 100, limitado ao disponível
  assert.equal(getConsumedQuantity("250 g"), "100 g");
  assert.equal(getConsumedQuantity("50 g"), "50 g");
});
