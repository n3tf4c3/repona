import assert from "node:assert/strict";
import test from "node:test";
import { isOperationVerifierCapableClient } from "./accountClientVersion";

test("CREATE seguro exige cliente 1.2.0 ou posterior", () => {
  assert.equal(isOperationVerifierCapableClient(null), false);
  assert.equal(isOperationVerifierCapableClient("1.1.9"), false);
  assert.equal(isOperationVerifierCapableClient("1.2.0"), true);
  assert.equal(isOperationVerifierCapableClient("2.0.0"), true);
  assert.equal(isOperationVerifierCapableClient("token\nforjado"), false);
});
