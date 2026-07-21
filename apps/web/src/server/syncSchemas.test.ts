import assert from "node:assert/strict";
import test from "node:test";
import { parseSyncClientVersion, syncTargetMatches } from "./syncSchemas";

test("versão do cliente aceita semver curta e rejeita valor impróprio para log", () => {
  assert.equal(parseSyncClientVersion("1.1.0"), "1.1.0");
  assert.equal(parseSyncClientVersion(" 2.0.0-beta.1 "), "2.0.0-beta.1");
  assert.equal(parseSyncClientVersion("token secreto\nforjado"), null);
  assert.equal(parseSyncClientVersion("x".repeat(33)), null);
});

test("preflight rejeita casa divergente antes de a rota chamar o merge", () => {
  let mutations = 0;
  const mergeIfAuthorized = (actualCasaId: number, expectedCasaId?: number) => {
    if (!syncTargetMatches(actualCasaId, expectedCasaId)) return;
    mutations += 1;
  };

  mergeIfAuthorized(22, 11);
  assert.equal(mutations, 0);
  mergeIfAuthorized(22, 22);
  assert.equal(mutations, 1);
});
