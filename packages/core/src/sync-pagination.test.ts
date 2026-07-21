import assert from "node:assert/strict";
import test from "node:test";
import {
  SYNC_PAGE_LIMITS,
  emptySyncHighWaterMarks,
  emptySyncSnapshot,
  isBoundedSyncPage,
  isSyncHighWaterMarks,
  syncSnapshotSize,
} from "./sync-pagination";

test("página de sync só aceita itens da coleção declarada", () => {
  const snapshot = emptySyncSnapshot();
  snapshot.purchases.push({
    productName: "Arroz",
    quantity: "1 un",
    purchasedAt: "2026-07-21T12:00:00.000Z",
  });

  assert.equal(isBoundedSyncPage(snapshot, "purchases"), true);
  assert.equal(isBoundedSyncPage(snapshot, "products"), false);
  assert.equal(syncSnapshotSize(snapshot), 1);
});

test("página de sync rejeita coleção acima do limite de custo", () => {
  const snapshot = emptySyncSnapshot();
  snapshot.prices = Array.from({ length: SYNC_PAGE_LIMITS.prices + 1 }, (_, index) => ({
    productName: "Arroz",
    priceCents: index + 1,
    recordedAt: "2026-07-21T12:00:00.000Z",
  }));

  assert.equal(isBoundedSyncPage(snapshot, "prices"), false);
});

test("high-water é finito e rejeita limites inválidos", () => {
  const marks = { ...emptySyncHighWaterMarks(), products: 100, activeListId: 7 };
  assert.equal(isSyncHighWaterMarks(marks), true);
  assert.equal(isSyncHighWaterMarks({ ...marks, prices: -1 }), false);
  assert.equal(isSyncHighWaterMarks({ ...marks, purchases: Number.MAX_SAFE_INTEGER + 1 }), false);
});
