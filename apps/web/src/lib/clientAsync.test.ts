import assert from "node:assert/strict";
import test from "node:test";
import {
  ClientOperationTimeoutError,
  transportErrorMessage,
  withClientTimeout,
} from "./clientAsync";

test("withClientTimeout devolve o resultado e limpa o timer", async () => {
  assert.equal(await withClientTimeout(Promise.resolve("ok"), 50), "ok");
});

test("withClientTimeout encerra uma operação que não responde", async () => {
  await assert.rejects(
    withClientTimeout(new Promise<never>(() => undefined), 5),
    ClientOperationTimeoutError
  );
});

test("transportErrorMessage distingue timeout sem presumir o resultado remoto", () => {
  assert.match(transportErrorMessage(new ClientOperationTimeoutError()), /Atualize a página/);
  assert.match(transportErrorMessage(new Error("network")), /interrompida/);
});
