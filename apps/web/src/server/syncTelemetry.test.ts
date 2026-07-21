import assert from "node:assert/strict";
import test from "node:test";
import { buildSyncTelemetryEvent } from "./syncTelemetry";

test("telemetria de rollout não possui campos de identidade/conteúdo", () => {
  const event = buildSyncTelemetryEvent({
    protocolVersion: 2,
    clientVersion: "1.1.0",
    phase: "upload",
    outcome: "ok",
  });
  assert.deepEqual(Object.keys(event).sort(), [
    "clientVersion",
    "outcome",
    "phase",
    "protocolVersion",
  ]);
});
