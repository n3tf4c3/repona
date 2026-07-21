import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveInventoryQuantity, subtractInventoryQuantity } from "./inventory-events";

test("dois devices consumindo a mesma base convergem para dois deltas", () => {
  const events = [
    { syncId: "00000000-0000-4000-8000-000000000001", eventType: "set" as const, quantity: "5 un", occurredAt: "2026-01-01T10:00:00Z" },
    { syncId: "00000000-0000-4000-8000-000000000002", eventType: "consumed" as const, quantity: "1 un", occurredAt: "2026-01-01T10:01:00Z" },
    { syncId: "00000000-0000-4000-8000-000000000003", eventType: "consumed" as const, quantity: "1 un", occurredAt: "2026-01-01T10:01:00Z" },
  ];
  assert.equal(deriveInventoryQuantity(events, "0 un"), "3 un");
});

test("replay do mesmo UUID não desconta novamente", () => {
  const consumed = {
    syncId: "00000000-0000-4000-8000-000000000002",
    quantity: "100 g",
    occurredAt: "2026-01-01T10:01:00Z",
  };
  assert.equal(
    deriveInventoryQuantity(
      [
        { syncId: "00000000-0000-4000-8000-000000000001", eventType: "set", quantity: "500 g", occurredAt: "2026-01-01T10:00:00Z" },
        consumed,
        consumed,
      ],
      "0 g",
    ),
    "400 g",
  );
});

test("duas páginas de devices distintos preservam baseline e convergem 5 para 3", () => {
  const baseline = {
    syncId: "00000000-0000-4000-8000-000000000010",
    eventType: "set" as const,
    quantity: "5 un",
    occurredAt: "2026-01-01T10:00:00Z",
  };
  const pageA = {
    syncId: "00000000-0000-4000-8000-000000000011",
    eventType: "consumed" as const,
    quantity: "1 un",
    occurredAt: "2026-01-01T10:01:00Z",
  };
  const pageB = {
    syncId: "00000000-0000-4000-8000-000000000012",
    eventType: "consumed" as const,
    quantity: "1 un",
    occurredAt: "2026-01-01T10:02:00Z",
  };

  const persistedAfterA = [baseline, pageA];
  assert.equal(deriveInventoryQuantity(persistedAfterA, "5 un"), "4 un");
  assert.equal(deriveInventoryQuantity([...persistedAfterA, pageB], "4 un"), "3 un");
});

test("set posterior redefine a base e unidades incompatíveis não corrompem saldo", () => {
  assert.equal(subtractInventoryQuantity("2 kg", "100 g"), "2 kg");
  assert.equal(
    deriveInventoryQuantity(
      [
        { eventType: "set", quantity: "5 un", occurredAt: "2026-01-01T10:00:00Z" },
        { quantity: "1 un", occurredAt: "2026-01-01T10:01:00Z" },
        { eventType: "set", quantity: "8 un", occurredAt: "2026-01-01T10:02:00Z" },
      ],
      "0 un",
    ),
    "8 un",
  );
});
