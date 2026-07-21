import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertSameDomainOperation,
  DOMAIN_IDEMPOTENCY_CONFLICT,
} from "./domainOperation";

const receipt = {
  operationType: "consume",
  casaId: 7,
  resourceId: 42,
  resultCount: 1,
};

test("retry aceita o recibo da mesma mutação de domínio", () => {
  assert.doesNotThrow(() =>
    assertSameDomainOperation(receipt, {
      operationType: "consume",
      casaId: 7,
      resourceId: 42,
    })
  );
});

test("a chave não pode mudar operação, casa ou recurso", () => {
  for (const expected of [
    { operationType: "finalize-purchase" as const, casaId: 7, resourceId: 42 },
    { operationType: "consume" as const, casaId: 8, resourceId: 42 },
    { operationType: "consume" as const, casaId: 7, resourceId: 43 },
  ]) {
    assert.throws(
      () => assertSameDomainOperation(receipt, expected),
      new RegExp(DOMAIN_IDEMPOTENCY_CONFLICT)
    );
  }
});
