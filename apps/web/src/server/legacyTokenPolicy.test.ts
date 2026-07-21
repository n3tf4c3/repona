import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyMigrationAliasValidUntil,
  legacyMigrationHardEnd,
  legacyTokenMayAuthenticate,
  legacyTokenMayMigrate,
  tokenRotationPolicyError,
} from "./legacyTokenPolicy";

const LEGACY_CODES = ["2".repeat(8), "2".repeat(12)];
const CURRENT = "A".repeat(26);
const CUTOFF = "2027-01-01T00:00:00.000Z";

test("token legado deixa de autenticar exatamente no cutoff configurado", () => {
  for (const legacy of LEGACY_CODES) {
    assert.equal(
      legacyTokenMayAuthenticate(legacy, new Date("2026-12-31T23:59:59.999Z"), CUTOFF),
      true
    );
    assert.equal(
      legacyTokenMayAuthenticate(legacy, new Date("2027-01-01T00:00:00.000Z"), CUTOFF),
      false
    );
  }
  assert.equal(
    legacyTokenMayAuthenticate(CURRENT, new Date("2030-01-01T00:00:00.000Z"), CUTOFF),
    true
  );
});

test("migração legada possui hard end absoluto e não aceita token atual", () => {
  const hardEnd = legacyMigrationHardEnd();
  for (const legacy of LEGACY_CODES) {
    assert.equal(
      legacyTokenMayMigrate(legacy, new Date(Date.parse(hardEnd) - 1)),
      true
    );
    assert.equal(legacyTokenMayMigrate(legacy, new Date(hardEnd)), false);
  }
  assert.equal(legacyTokenMayMigrate(CURRENT, new Date("2026-01-01T00:00:00.000Z")), false);
});

test("alias de outro aparelho permanece recuperável até o hard end", () => {
  const hardEndMs = Date.parse(legacyMigrationHardEnd());
  assert.equal(legacyMigrationAliasValidUntil().getTime(), hardEndMs);
});

test("recibo comprometido continua recuperável depois do hard end", () => {
  const afterHardEnd = new Date("2027-04-02T00:00:00.000Z");
  for (const legacy of LEGACY_CODES) {
    assert.equal(
      tokenRotationPolicyError(legacy, "migrate", afterHardEnd, true),
      null
    );
    assert.equal(
      tokenRotationPolicyError(legacy, "migrate", afterHardEnd, false),
      "LEGACY_TOKEN_MIGRATION_EXPIRED"
    );
  }
});
