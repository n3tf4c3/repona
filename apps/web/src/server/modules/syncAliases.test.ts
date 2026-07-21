import assert from "node:assert/strict";
import test from "node:test";
import { matchProduct } from "@repona/core";
import { aliasForFallbackProductMatch, indexProductSyncAliases } from "./syncAliases";

test("alias aposentado resolve para o produto canônico", () => {
  const ids = new Map([["canonical", 10]]);
  const retired = indexProductSyncAliases(ids, [
    { oldSyncId: "duplicate", canonicalProductId: 10 },
  ]);

  assert.equal(ids.get("canonical"), 10);
  assert.equal(ids.get("duplicate"), 10);
  assert.equal(retired.has("duplicate"), true);
  assert.equal(retired.has("canonical"), false);
  assert.deepEqual(
    matchProduct(
      { syncId: "duplicate", name: "nome antigo", barcode: null },
      { idBySyncId: ids, idByName: new Map() }
    ),
    { id: 10, matchedBy: "syncId" }
  );
});

test("cadeia já reconciliada aponta todos os aliases para o canônico atual", () => {
  const ids = new Map<string, number>();
  const retired = indexProductSyncAliases(ids, [
    { oldSyncId: "old-a", canonicalProductId: 30 },
    { oldSyncId: "old-b", canonicalProductId: 30 },
  ]);

  assert.deepEqual([...retired].sort(), ["old-a", "old-b"]);
  assert.equal(ids.get("old-a"), 30);
  assert.equal(ids.get("old-b"), 30);
});

test("match legado por nome/barcode persiste o syncId recebido como alias", () => {
  assert.deepEqual(
    aliasForFallbackProductMatch({
      incomingSyncId: "device-id",
      canonicalSyncId: "server-id",
      canonicalProductId: 10,
      matchedBy: "name",
    }),
    { oldSyncId: "device-id", canonicalProductId: 10 }
  );
  assert.deepEqual(
    aliasForFallbackProductMatch({
      incomingSyncId: "barcode-device-id",
      canonicalSyncId: "server-id",
      canonicalProductId: 10,
      matchedBy: "barcode",
    }),
    { oldSyncId: "barcode-device-id", canonicalProductId: 10 }
  );
});

test("match canônico/sem divergência não cria alias", () => {
  assert.equal(
    aliasForFallbackProductMatch({
      incomingSyncId: "server-id",
      canonicalSyncId: "server-id",
      canonicalProductId: 10,
      matchedBy: "syncId",
    }),
    null
  );
  assert.equal(
    aliasForFallbackProductMatch({
      incomingSyncId: undefined,
      canonicalSyncId: "server-id",
      canonicalProductId: 10,
      matchedBy: "name",
    }),
    null
  );
});
