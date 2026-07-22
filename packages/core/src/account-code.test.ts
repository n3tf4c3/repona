import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CASA_CODE_ALPHABET,
  CASA_CODE_LENGTH,
  CASA_CODE_REGEX,
} from "./account-code";

test("credencial tem 26 caracteres base32 (>= 128 bits)", () => {
  assert.equal(CASA_CODE_ALPHABET.length, 32);
  assert.equal(CASA_CODE_LENGTH, 26);
  assert.ok(CASA_CODE_LENGTH * Math.log2(CASA_CODE_ALPHABET.length) >= 128);
});

test("validação aceita só o formato de 26 caracteres do alfabeto", () => {
  assert.match("A".repeat(26), CASA_CODE_REGEX);
  assert.doesNotMatch("A".repeat(25), CASA_CODE_REGEX);
  assert.doesNotMatch("A".repeat(27), CASA_CODE_REGEX);
  assert.doesNotMatch("2".repeat(8), CASA_CODE_REGEX);
  assert.doesNotMatch("2".repeat(12), CASA_CODE_REGEX);
  // '0', '1', 'O', 'I' não estão no alfabeto (ambíguos).
  assert.doesNotMatch("0".repeat(26), CASA_CODE_REGEX);
});
