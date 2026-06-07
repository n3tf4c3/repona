import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateShoppingTotal } from "./shopping-total";

test("estimateShoppingTotal: lista vazia", () => {
  assert.deepEqual(estimateShoppingTotal([]), {
    totalCents: 0,
    pricedCount: 0,
    missingCount: 0,
  });
});

test("estimateShoppingTotal: preço × quantidade em unidades", () => {
  const r = estimateShoppingTotal([
    { priceCents: 479, quantity: "3 un" }, // 14,37
    { priceCents: 519, quantity: "1 un" }, // 5,19
  ]);
  assert.equal(r.totalCents, 479 * 3 + 519);
  assert.equal(r.pricedCount, 2);
  assert.equal(r.missingCount, 0);
});

test("estimateShoppingTotal: peso em kg e gramas (preço por kg)", () => {
  const r = estimateShoppingTotal([
    { priceCents: 3598, quantity: "0,65 kg" }, // 23,387 -> 2339
    { priceCents: 1000, quantity: "500 g" }, // 5,00 -> 500
  ]);
  assert.equal(r.totalCents, Math.round(3598 * 0.65) + 500);
});

test("estimateShoppingTotal: itens sem preço ficam de fora e são contados", () => {
  const r = estimateShoppingTotal([
    { priceCents: 200, quantity: "2 un" }, // 4,00
    { priceCents: null, quantity: "1 un" },
  ]);
  assert.equal(r.totalCents, 400);
  assert.equal(r.pricedCount, 1);
  assert.equal(r.missingCount, 1);
});

test("estimateShoppingTotal: quantidade inválida vira ×1", () => {
  const r = estimateShoppingTotal([{ priceCents: 700, quantity: "a gosto" }]);
  assert.equal(r.totalCents, 700);
});
