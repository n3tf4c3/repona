import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSameAccountOperation, IDEMPOTENCY_CONFLICT } from "./accountOperation";

const stored = { operationType: "create", requestHash: "hash-a" };

test("retry da mesma mutação aceita o recibo persistido", () => {
  assert.doesNotThrow(() => assertSameAccountOperation(stored, "create", "hash-a"));
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

