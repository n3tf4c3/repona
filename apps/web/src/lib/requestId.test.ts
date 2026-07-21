import assert from "node:assert/strict";
import test from "node:test";
import { safeRequestId } from "./requestId";

test("request ID seguro e preservado ponta a ponta", () => {
  const received = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.equal(safeRequestId(received, () => "generated-id"), received);
});

test("request ID ausente, alterado ou injetado e substituido", () => {
  for (const candidate of [
    null,
    undefined,
    "curto",
    " request-id-valido ",
    "request\nid-injetado",
    "request,id,duplicado",
    "A".repeat(8),
    "2".repeat(12),
    "B".repeat(26),
    "x".repeat(129),
  ]) {
    assert.equal(safeRequestId(candidate, () => "generated-id"), "generated-id");
  }
});
