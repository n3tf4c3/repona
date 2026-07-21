import assert from "node:assert/strict";
import test from "node:test";
import { emptySyncHighWaterMarks } from "@repona/core";
import { decodeSyncCursor, encodeSyncCursor, nextSyncCollection } from "./syncCursor";

test("cursor de sync faz round-trip e começa em products", () => {
  assert.deepEqual(decodeSyncCursor(null), { collection: "products", afterId: 0 });
  const highWater = { ...emptySyncHighWaterMarks(), consumptions: 99, activeListId: 7 };
  const encoded = encodeSyncCursor({ collection: "consumptions", afterId: 42, highWater });
  assert.deepEqual(decodeSyncCursor(encoded), {
    collection: "consumptions",
    afterId: 42,
    highWater,
  });
  assert.ok(encoded.length < 256);
  const max = Number.MAX_SAFE_INTEGER;
  const worstCase = encodeSyncCursor({
    collection: "listItems",
    afterId: max,
    highWater: {
      products: max,
      purchases: max,
      consumptions: max,
      prices: max,
      listItems: max,
      activeListId: max,
    },
  });
  assert.ok(worstCase.length < 256);
});

test("cursor de sync rejeita conteúdo forjado ou fora dos limites", () => {
  const invalidCollection = Buffer.from(
    JSON.stringify({ collection: "secrets", afterId: 1 })
  ).toString("base64url");
  const invalidId = Buffer.from(
    JSON.stringify({ collection: "products", afterId: -1 })
  ).toString("base64url");

  assert.equal(decodeSyncCursor(invalidCollection), null);
  assert.equal(decodeSyncCursor(invalidId), null);
  assert.equal(decodeSyncCursor("%%%"), null);

  const invalidUpper = Buffer.from(
    JSON.stringify({ v: 2, c: 0, a: 1, u: [1, 2, 3, 4, 5, -1] })
  ).toString("base64url");
  assert.equal(decodeSyncCursor(invalidUpper), null);
});

test("ordem de coleções garante produtos antes dos eventos", () => {
  assert.equal(nextSyncCollection("products"), "purchases");
  assert.equal(nextSyncCollection("prices"), "listItems");
  assert.equal(nextSyncCollection("listItems"), null);
});
