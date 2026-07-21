import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearOperationId,
  getOrCreateOperationId,
  type OperationStorage,
} from "./idempotentMutation";

const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fakeStorage(): OperationStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

test("reutiliza a chave persistida até a mutação ser confirmada", () => {
  const storage = fakeStorage();
  assert.equal(getOrCreateOperationId("consume:1", storage, () => UUID_A), UUID_A);
  assert.equal(getOrCreateOperationId("consume:1", storage, () => UUID_B), UUID_A);
  clearOperationId("consume:1", storage);
  assert.equal(getOrCreateOperationId("consume:1", storage, () => UUID_B), UUID_B);
});

test("estado inválido nunca vira Idempotency-Key", () => {
  const storage = fakeStorage();
  storage.setItem("repona:pending-operation:finalize", "corrompido");
  assert.equal(getOrCreateOperationId("finalize", storage, () => UUID_A), UUID_A);
});
