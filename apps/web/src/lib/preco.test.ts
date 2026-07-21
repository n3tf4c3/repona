import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCentsBRL } from "./preco";

test("formatCentsBRL: centavos -> BRL com virgula e duas casas", () => {
  assert.equal(formatCentsBRL(0), "R$ 0,00");
  assert.equal(formatCentsBRL(100), "R$ 1,00");
  assert.equal(formatCentsBRL(1599), "R$ 15,99");
  assert.equal(formatCentsBRL(5), "R$ 0,05");
  assert.equal(formatCentsBRL(123456), "R$ 1234,56");
});
