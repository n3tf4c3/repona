import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertDeleteAccountOperationReplay,
  assertRecoverableTokenOperation,
  assertSameAccountOperation,
  IDEMPOTENCY_CONFLICT,
} from "./accountOperation";

const stored = { operationType: "create", requestHash: "hash-a" };

test("retry da mesma mutação aceita o recibo persistido", () => {
  assert.doesNotThrow(() => assertSameAccountOperation(stored, "create", "hash-a"));
});

test("dump com operationId+payload não recupera token sem verifier cliente", () => {
  const receipt = {
    operationVersion: 2,
    operationType: "create",
    requestHash: "hash-a",
    resultTokenEnc: "token-cifrado-do-dump",
    operationVerifierHash: "verifier-hash-correto",
  };
  assert.throws(
    () => assertRecoverableTokenOperation(receipt, "create", "hash-errado", "hash-a"),
    new RegExp(IDEMPOTENCY_CONFLICT)
  );
  assert.throws(
    () => assertRecoverableTokenOperation(
      { ...receipt, operationVersion: 1, operationVerifierHash: null },
      "create",
      "verifier-hash-correto",
      "hash-a"
    ),
    new RegExp(IDEMPOTENCY_CONFLICT)
  );
  assert.doesNotThrow(() =>
    assertRecoverableTokenOperation(receipt, "create", "verifier-hash-correto", "hash-a")
  );
});

test("a chave não pode trocar de tipo nem de payload", () => {
  assert.throws(
    () => assertSameAccountOperation(stored, "delete", "hash-a"),
    new RegExp(IDEMPOTENCY_CONFLICT)
  );
  assert.throws(
    () => assertSameAccountOperation(stored, "create", "hash-b"),
    new RegExp(IDEMPOTENCY_CONFLICT)
  );
});

test("replay DELETE v1 exige o hash legado exato e v2 exige o hash estável", () => {
  assert.doesNotThrow(() =>
    assertDeleteAccountOperationReplay(
      { operationVersion: 1, operationType: "delete", requestHash: "legacy-a" },
      "stable-a",
      "legacy-a"
    )
  );
  assert.throws(
    () =>
      assertDeleteAccountOperationReplay(
        { operationVersion: 1, operationType: "delete", requestHash: "legacy-a" },
        "stable-a",
        "legacy-b"
      ),
    new RegExp(IDEMPOTENCY_CONFLICT)
  );
  assert.throws(
    () =>
      assertDeleteAccountOperationReplay(
        { operationVersion: 1, operationType: "create", requestHash: "legacy-a" },
        "stable-a",
        "legacy-a"
      ),
    new RegExp(IDEMPOTENCY_CONFLICT)
  );
  assert.doesNotThrow(() =>
    assertDeleteAccountOperationReplay(
      { operationVersion: 2, operationType: "delete", requestHash: "stable-a" },
      "stable-a",
      "legacy-a"
    )
  );
  assert.throws(
    () =>
      assertDeleteAccountOperationReplay(
        { operationVersion: 2, operationType: "delete", requestHash: "legacy-a" },
        "stable-a",
        "legacy-a"
      ),
    new RegExp(IDEMPOTENCY_CONFLICT)
  );
});
