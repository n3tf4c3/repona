import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizePrices } from "./price";

test("summarizePrices: sem pontos", () => {
  assert.equal(summarizePrices([]), null);
});

test("summarizePrices: um único preço é flat", () => {
  const s = summarizePrices([{ priceCents: 890, recordedAt: "2026-06-01T10:00:00.000Z" }]);
  assert.deepEqual(s, {
    count: 1,
    lastCents: 890,
    previousCents: null,
    minCents: 890,
    maxCents: 890,
    avgCents: 890,
    trend: "flat",
    trendPercentage: null,
  });
});

test("summarizePrices: usa o mais recente e calcula tendência", () => {
  const s = summarizePrices([
    { priceCents: 500, recordedAt: "2026-06-01T10:00:00.000Z" },
    { priceCents: 720, recordedAt: "2026-06-03T10:00:00.000Z" }, // mais recente
    { priceCents: 610, recordedAt: "2026-06-02T10:00:00.000Z" },
  ]);
  assert.equal(s?.lastCents, 720);
  assert.equal(s?.previousCents, 610);
  assert.equal(s?.minCents, 500);
  assert.equal(s?.maxCents, 720);
  assert.equal(s?.avgCents, 610);
  assert.equal(s?.trend, "up");
  assert.equal(s?.trendPercentage, 18);
});

test("summarizePrices: queda de preço", () => {
  const s = summarizePrices([
    { priceCents: 800, recordedAt: "2026-06-02T10:00:00.000Z" },
    { priceCents: 650, recordedAt: "2026-06-05T10:00:00.000Z" },
  ]);
  assert.equal(s?.trend, "down");
  assert.equal(s?.trendPercentage, -19);
});
