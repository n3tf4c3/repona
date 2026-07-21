import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CASA_CODE_ALPHABET,
  CASA_CODE_ENTROPY_BITS,
  CASA_CODE_LENGTH,
  CASA_CODE_CURRENT_REGEX,
  CASA_CODE_LEGACY_REGEX,
  CASA_CODE_REGEX,
  isLegacyCasaCode,
} from "./account-code";

test("credencial nova tem pelo menos 128 bits de entropia", () => {
  assert.equal(CASA_CODE_ALPHABET.length, 32);
  assert.equal(CASA_CODE_LENGTH, 26);
  assert.ok(CASA_CODE_ENTROPY_BITS >= 128);
});

test("validação aceita formato atual e legado, mas rejeita tamanhos intermediários", () => {
  assert.match("A".repeat(26), CASA_CODE_REGEX);
  assert.match("2".repeat(8), CASA_CODE_REGEX);
  assert.match("2".repeat(12), CASA_CODE_REGEX);
  assert.doesNotMatch("A".repeat(25), CASA_CODE_REGEX);
  assert.doesNotMatch("A".repeat(13), CASA_CODE_REGEX);
  assert.doesNotMatch("0".repeat(26), CASA_CODE_REGEX);
});

test("formatos atual e legado podem ser distinguidos antes do cutoff", () => {
  assert.match("A".repeat(26), CASA_CODE_CURRENT_REGEX);
  assert.doesNotMatch("A".repeat(12), CASA_CODE_CURRENT_REGEX);
  assert.match("2".repeat(12), CASA_CODE_LEGACY_REGEX);
  assert.match("2".repeat(8), CASA_CODE_LEGACY_REGEX);
  assert.doesNotMatch("2".repeat(26), CASA_CODE_LEGACY_REGEX);
  assert.equal(isLegacyCasaCode(`  ${"a".repeat(12)}  `), true);
  assert.equal(isLegacyCasaCode("A".repeat(8)), true);
  assert.equal(isLegacyCasaCode("A".repeat(26)), false);
});
