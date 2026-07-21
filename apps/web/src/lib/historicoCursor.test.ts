import assert from "node:assert/strict";
import test from "node:test";

import { decodeHistoricoCursor, encodeHistoricoCursor } from "./historicoCursor";

test("cursor de histórico faz round-trip inclusive com acentos", () => {
  const cursor = {
    purchasedAt: "2026-07-21T12:00:00.000Z",
    sourceNameKey: "Feira do mês",
  };
  assert.deepEqual(decodeHistoricoCursor(encodeHistoricoCursor(cursor)), cursor);
});

test("cursor de histórico rejeita entrada malformada ou excessiva", () => {
  assert.equal(decodeHistoricoCursor("não-é-base64-json"), undefined);
  assert.equal(
    decodeHistoricoCursor(
      encodeHistoricoCursor({ purchasedAt: "inválida", sourceNameKey: "Feira" }),
    ),
    undefined,
  );
  assert.equal(decodeHistoricoCursor("a".repeat(385)), undefined);
});
