import assert from "node:assert/strict";
import test from "node:test";
import { buildSyncTelemetryEvent, syncRequestId } from "./syncTelemetry";

test("telemetria de rollout não possui campos de identidade/conteúdo", () => {
  const event = buildSyncTelemetryEvent({
    protocolVersion: 2,
    clientVersion: "1.1.0",
    phase: "upload",
    outcome: "ok",
    requestId: "00000000-0000-4000-8000-000000000123",
    token: "TOKEN-NAO-PODE-VAZAR",
    payload: { produto: "NAO-PODE-VAZAR" },
    casaId: 987654,
  } as Parameters<typeof buildSyncTelemetryEvent>[0]);
  assert.deepEqual(Object.keys(event).sort(), [
    "clientVersion",
    "outcome",
    "phase",
    "protocolVersion",
    "requestId",
  ]);
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes("TOKEN-NAO-PODE-VAZAR"), false);
  assert.equal(serialized.includes("NAO-PODE-VAZAR"), false);
  assert.equal(serialized.includes("987654"), false);
});

test("requestId do sync preserva somente valor seguro e gera fallback", () => {
  const requestId = "00000000-0000-4000-8000-000000000123";
  assert.equal(syncRequestId(requestId), requestId);
  assert.equal(syncRequestId(` ${requestId} `, () => "fallback-space"), "fallback-space");
  assert.equal(syncRequestId("2".repeat(8), () => "fallback-token"), "fallback-token");
  assert.equal(syncRequestId("token\nindevido", () => "fallback-1234"), "fallback-1234");
  assert.equal(syncRequestId(null, () => "fallback-5678"), "fallback-5678");
});
