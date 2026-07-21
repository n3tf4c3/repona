import { test } from "node:test";
import assert from "node:assert/strict";
import type { PurchaseHistoryDTO } from "@repona/core";
import { agruparHistorico } from "./historico";

function compra(over: Partial<PurchaseHistoryDTO>): PurchaseHistoryDTO {
  return {
    id: 1,
    productId: 1,
    productName: "Arroz",
    category: "Mercearia",
    quantity: "1 un",
    purchasedAt: "2020-03-15T10:00:00.000Z",
    sourceListId: null,
    sourceListName: "Feira",
    ...over,
  };
}

test("agruparHistorico: mesma data + mesma lista viram uma compra com varias linhas", () => {
  const grupos = agruparHistorico([
    compra({ id: 1, productId: 1, productName: "Arroz" }),
    compra({ id: 2, productId: 2, productName: "Feijao" }),
  ]);
  assert.equal(grupos.length, 1);
  assert.equal(grupos[0].items.length, 1);
  assert.equal(grupos[0].items[0].lines.length, 2);
  // Data antiga (2020): rotulo por mes+ano, estavel no tempo.
  assert.equal(grupos[0].title, "Março 2020");
});

test("agruparHistorico: mesma data mas listas diferentes viram compras separadas", () => {
  const grupos = agruparHistorico([
    compra({ id: 1, sourceListName: "Feira" }),
    compra({ id: 2, sourceListName: "Mercado" }),
  ]);
  assert.equal(grupos.length, 1); // mesmo dia -> mesmo grupo
  assert.equal(grupos[0].items.length, 2); // listas distintas -> 2 compras
});

test("agruparHistorico: total nulo sem mapa de precos, calculado com o mapa", () => {
  const registros = [compra({ id: 1, productId: 7, quantity: "2 un" })];
  const semPreco = agruparHistorico(registros);
  assert.equal(semPreco[0].items[0].total, null);

  const comPreco = agruparHistorico(registros, new Map([[7, 500]]));
  assert.notEqual(comPreco[0].items[0].total, null);
});
