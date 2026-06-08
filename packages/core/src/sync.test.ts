import { test } from "node:test";
import assert from "node:assert/strict";
import { uuidv4, matchProduct, type ProductMatchMaps } from "./sync";

test("uuidv4: formato v4 (versão 4, variante 8/9/a/b)", () => {
  const id = uuidv4();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(uuidv4(), uuidv4());
});

const maps = (): ProductMatchMaps => ({
  idBySyncId: new Map([["sync-1", 10]]),
  idByName: new Map([["leite", 10], ["café", 20]]),
});

test("matchProduct: casa por syncId primeiro", () => {
  assert.deepEqual(matchProduct({ syncId: "sync-1", name: "Outro nome" }, maps()), {
    id: 10,
    matchedBy: "syncId",
  });
});

test("matchProduct: cai para o nome quando syncId não bate", () => {
  assert.deepEqual(matchProduct({ syncId: "sync-x", name: "Café" }, maps()), {
    id: 20,
    matchedBy: "name",
  });
});

test("matchProduct: cai para o nome quando syncId ausente (cliente legado)", () => {
  assert.deepEqual(matchProduct({ name: "Leite" }, maps()), { id: 10, matchedBy: "name" });
});

test("matchProduct: nenhum match retorna none", () => {
  assert.deepEqual(matchProduct({ syncId: "sync-x", name: "Novo" }, maps()), {
    id: null,
    matchedBy: "none",
  });
});
