import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInventoryAlerts, buildRebuySuggestion } from "./home-rules";
import type { ProductDTO } from "./contracts";

function produto(over: Partial<ProductDTO>): ProductDTO {
  return {
    id: 1,
    name: "Produto",
    category: "Mercearia",
    barcode: null,
    photoUri: null,
    purchaseCount: 0,
    status: "active",
    alertThreshold: null,
    inventoryQuantity: "5 un",
    inventoryStatus: "in_stock",
    consumptionCount: 0,
    lastConsumedAt: null,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

test("alerta 'missing' aparece e vem antes de 'low'", () => {
  const alerts = buildInventoryAlerts([
    produto({ id: 1, name: "A", inventoryQuantity: "1 un", inventoryStatus: "in_stock" }),
    produto({ id: 2, name: "B", inventoryStatus: "missing", inventoryQuantity: "0 un" }),
  ]);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].level, "missing");
  assert.equal(alerts[1].level, "low");
});

test("estoque alto não gera alerta", () => {
  const alerts = buildInventoryAlerts([produto({ inventoryQuantity: "5 un" })]);
  assert.equal(alerts.length, 0);
});

test("limiar customizado define estoque baixo", () => {
  const alerts = buildInventoryAlerts([
    produto({ inventoryQuantity: "3 un", alertThreshold: "3 un" }),
  ]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].level, "low");
});

test("sugestão prioriza item em falta e ignora os já na lista", () => {
  const products = [
    produto({ id: 1, name: "Em falta", inventoryStatus: "missing", inventoryQuantity: "0 un", purchaseCount: 3 }),
    produto({ id: 2, name: "Recorrente", purchaseCount: 10 }),
  ];
  const s = buildRebuySuggestion(products, []);
  assert.equal(s?.product.id, 1);
  assert.equal(s?.badge, "Reposição urgente");

  // com o item em falta já na lista, sobra o recorrente
  const s2 = buildRebuySuggestion(products, [1]);
  assert.equal(s2?.product.id, 2);
  assert.equal(s2?.badge, "Recorrente");
});

test("sem candidatos retorna null", () => {
  const s = buildRebuySuggestion([produto({ purchaseCount: 1, consumptionCount: 0 })], []);
  assert.equal(s, null);
});
