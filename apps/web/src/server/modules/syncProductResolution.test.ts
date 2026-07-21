import assert from "node:assert/strict";
import test from "node:test";
import { productNameKey } from "@repona/core";
import {
  assertSyncProductReferencesResolved,
  resolveSyncProductReference,
  SyncUnknownProductError,
} from "./syncProductResolution";

test("evento resolve primeiro por syncId/alias e depois por nome NFC", () => {
  const bySyncId = new Map([["retired-id", 7]]);
  const byName = new Map([[productNameKey("Café"), 9]]);

  assert.equal(
    resolveSyncProductReference(
      { productSyncId: "retired-id", productName: "nome antigo" },
      byName,
      bySyncId
    ),
    7
  );
  assert.equal(
    resolveSyncProductReference({ productName: "Cafe\u0301" }, byName, bySyncId),
    9
  );
});

test("pagina de evento/lista com produto desconhecido falha antes do ACK", () => {
  assert.throws(
    () =>
      assertSyncProductReferencesResolved(
        [{ productSyncId: "unknown", productName: "Ausente" }],
        new Map(),
        new Map()
      ),
    SyncUnknownProductError
  );
});
