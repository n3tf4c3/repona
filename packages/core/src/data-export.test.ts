import { test } from "node:test";
import assert from "node:assert/strict";
import { exportToJSON, exportToCSV, validateHouseImport, type HouseExportData } from "./data-export";

const sampleData: HouseExportData = {
  version: "1.0",
  exportedAt: "2026-07-23T12:00:00.000Z",
  houseName: "Casa Exemplo",
  products: [
    {
      name: "Leite Integral",
      category: "Laticínios",
      unit: "l",
      inventoryQuantity: "2 l",
      inventoryStatus: "in_stock",
      alertThreshold: "1 l",
      occasional: false,
      barcode: "7891234567890",
    },
    {
      name: "Café Especial",
      category: "Mercearia",
      unit: "un",
      inventoryQuantity: "0",
      inventoryStatus: "missing",
      occasional: false,
    },
  ],
  shoppingListItems: [
    { productName: "Café Especial", quantity: "2", checked: false },
  ],
};

test("exportToJSON e validateHouseImport fazem round-trip", () => {
  const jsonStr = exportToJSON(sampleData);
  const result = validateHouseImport(jsonStr);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.products.length, 2);
    assert.equal(result.data.products[0].name, "Leite Integral");
    assert.equal(result.data.shoppingListItems?.length, 1);
  }
});

test("exportToCSV formata cabeçalho e linhas corretamente", () => {
  const csvStr = exportToCSV(sampleData);
  assert.ok(csvStr.includes('"Nome","Categoria"'));
  assert.ok(csvStr.includes('"Leite Integral","Laticínios"'));
  assert.ok(csvStr.includes('"Café Especial"'));
});

test("validateHouseImport rejeita payload sem produtos válidos", () => {
  const invalidJson = JSON.stringify({ version: "1.0", products: [] });
  const result = validateHouseImport(invalidJson);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error.includes("Nenhum produto válido"));
  }
});
