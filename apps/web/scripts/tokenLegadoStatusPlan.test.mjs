import assert from "node:assert/strict";
import test from "node:test";
import {
  countTokenFormats,
  formatTokenStatus,
  tokenStatusExitCode,
} from "./tokenLegadoStatusPlan.mjs";

test("status agrega formatos sem imprimir tokens ou identidades", () => {
  const current = "A".repeat(26);
  const legacy = "2".repeat(12);
  const deployedLegacy = "3".repeat(8);
  const counts = countTokenFormats([current, legacy, deployedLegacy, "invalido"]);
  assert.deepEqual(counts, { current: 1, legacy: 2, invalid: 1 });
  const output = formatTokenStatus(counts);
  assert.equal(output, "atuais=1 legados=2 invalidos=1");
  assert.equal(output.includes(current), false);
  assert.equal(output.includes(legacy), false);
  assert.equal(output.includes(deployedLegacy), false);
});

test("legado após hard end produz exit não-zero", () => {
  const hardEnd = new Date("2027-04-01T00:00:00.000Z");
  assert.equal(
    tokenStatusExitCode(
      { current: 0, legacy: 1, invalid: 0 },
      new Date("2027-04-01T00:00:00.000Z"),
      hardEnd
    ),
    2
  );
  assert.equal(
    tokenStatusExitCode(
      { current: 0, legacy: 0, invalid: 1 },
      new Date("2027-04-02T00:00:00.000Z"),
      hardEnd
    ),
    3
  );
});

test("formato inválido falha em qualquer data", () => {
  assert.equal(
    tokenStatusExitCode(
      { current: 2, legacy: 0, invalid: 1 },
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2027-04-01T00:00:00.000Z")
    ),
    3
  );
});
