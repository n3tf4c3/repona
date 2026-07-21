import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledgeTokenRotation,
  recoverPendingTokenRotation,
  requestTokenRotation,
  TokenRotationError,
  type TokenRotationOperation,
} from "./tokenRotation";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const LEGACY = "2".repeat(12);
const CURRENT = "A".repeat(26);
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function withFixedUuid(run: () => Promise<void>) {
  const originalRandomUUID = crypto.randomUUID;
  Object.defineProperty(crypto, "randomUUID", { value: () => UUID, configurable: true });
  try {
    await run();
  } finally {
    Object.defineProperty(crypto, "randomUUID", { value: originalRandomUUID, configurable: true });
  }
}

test("resposta perdida preserva id+verifier e retry promove o mesmo token", async () => {
  await withFixedUuid(async () => {
    const storage = new MemoryStorage();
    let attempts = 0;
    let verifier = "";
    const fetcher = async (_input: string, init: RequestInit) => {
      attempts += 1;
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Idempotency-Key"), UUID);
      const receivedVerifier = headers.get("x-operation-verifier") ?? "";
      assert.match(receivedVerifier, /^[0-9a-f]{64}$/);
      assert.notEqual(receivedVerifier, UUID.replaceAll("-", ""));
      if (verifier) assert.equal(receivedVerifier, verifier);
      verifier = receivedVerifier;
      if (attempts === 1) throw new Error("response lost after commit");
      return Response.json({ token: CURRENT, casaId: 7, credentialVersion: 1 });
    };

    await assert.rejects(() => requestTokenRotation(LEGACY, "migrate", storage, fetcher));
    assert.equal(storage.values.size, 1);
    const result = await requestTokenRotation(LEGACY, "migrate", storage, fetcher);
    assert.equal(result.token, CURRENT);
    assert.equal(result.operation.verifier, verifier);
    assert.equal(storage.values.size, 1, "200 ainda não é ACK durável do cliente");
    acknowledgeTokenRotation(result.operation, storage);
    assert.equal(storage.values.size, 0);
  });
});

test("localStorage persiste somente mode/id/verifier para legados 8/12 e atual", async () => {
  await withFixedUuid(async () => {
    for (const source of ["2".repeat(8), "3".repeat(12), CURRENT]) {
      const storage = new MemoryStorage();
      const mode = source.length === 26 ? "rotate" as const : "migrate" as const;
      const result = await requestTokenRotation(source, mode, storage, async () =>
        Response.json({ token: "B".repeat(26), casaId: 7, credentialVersion: 1 })
      );
      const persisted = JSON.parse([...storage.values.values()][0]) as Record<string, unknown>;
      assert.deepEqual(Object.keys(persisted).sort(), ["mode", "operationId", "verifier"]);
      assert.equal(JSON.stringify(persisted).includes(source), false);
      acknowledgeTokenRotation(result.operation, storage);
    }
  });
});

test("200 seguido de crash recupera com operationId+verifier, sem token antigo", async () => {
  await withFixedUuid(async () => {
    const storage = new MemoryStorage();
    const initial = await requestTokenRotation(CURRENT, "rotate", storage, async () =>
      Response.json({ token: "B".repeat(26), casaId: 9, credentialVersion: 2 })
    );
    assert.equal(storage.values.size, 1);

    const recovered = await recoverPendingTokenRotation(
      "rotate",
      storage,
      async (_input, init) => {
        const headers = new Headers(init.headers);
        assert.equal(headers.get("x-casa-code"), null);
        assert.equal(headers.get("x-operation-verifier"), initial.operation.verifier);
        assert.deepEqual(JSON.parse(String(init.body)), { mode: "recover" });
        return Response.json({ token: "B".repeat(26), casaId: 9, credentialVersion: 2 });
      }
    );
    assert.equal(recovered?.token, "B".repeat(26));
    acknowledgeTokenRotation(recovered!.operation, storage);
    assert.equal(storage.values.size, 0);
  });
});

test("404 de recovery pode anteceder o commit e nunca apaga o verifier", async () => {
  await withFixedUuid(async () => {
    const storage = new MemoryStorage();
    await requestTokenRotation(CURRENT, "rotate", storage, async () =>
      Response.json({ token: "B".repeat(26), casaId: 9, credentialVersion: 2 })
    );
    await assert.rejects(
      () => recoverPendingTokenRotation("rotate", storage, async () =>
        Response.json({ error: "TOKEN_ROTATION_RECEIPT_NOT_FOUND" }, { status: 404 })
      ),
      (error: unknown) =>
        error instanceof TokenRotationError &&
        error.code === "TOKEN_ROTATION_RECEIPT_NOT_FOUND"
    );
    assert.equal(storage.values.size, 1);
  });
});

test("reload sem vínculo efêmero fica recovery-only e não reenvia bearer", async () => {
  const storage = new MemoryStorage();
  const operation = {
    mode: "migrate" as const,
    operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    verifier: "ef".repeat(32),
  };
  storage.setItem(
    "repona:pending-token-rotation:migrate",
    JSON.stringify(operation)
  );
  let calls = 0;
  await assert.rejects(
    () => requestTokenRotation(LEGACY, "migrate", storage, async (_input, init) => {
      calls += 1;
      assert.equal(new Headers(init.headers).get("x-casa-code"), null);
      assert.deepEqual(JSON.parse(String(init.body)), { mode: "recover" });
      return Response.json(
        { error: "TOKEN_ROTATION_RECEIPT_NOT_FOUND" },
        { status: 404 }
      );
    }),
    (error: unknown) =>
      error instanceof TokenRotationError &&
      error.code === "PENDING_ROTATION_RECOVERY"
  );
  assert.equal(calls, 1);
  assert.equal(storage.values.size, 1);
});

test("retry faz recovery primeiro e, após 404 não terminal, reenvia a mesma operação", async () => {
  await withFixedUuid(async () => {
    const storage = new MemoryStorage();
    let firstOperationHeaders: Headers | null = null;
    await assert.rejects(() =>
      requestTokenRotation(LEGACY, "migrate", storage, async (_input, init) => {
        firstOperationHeaders = new Headers(init.headers);
        throw new Error("response lost");
      })
    );

    let attempts = 0;
    const result = await requestTokenRotation(LEGACY, "migrate", storage, async (_input, init) => {
      attempts += 1;
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Idempotency-Key"), firstOperationHeaders!.get("Idempotency-Key"));
      assert.equal(
        headers.get("x-operation-verifier"),
        firstOperationHeaders!.get("x-operation-verifier")
      );
      assert.match(headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
      if (attempts === 1) {
        assert.equal(headers.get("x-casa-code"), null);
        assert.deepEqual(JSON.parse(String(init.body)), { mode: "recover" });
        return Response.json(
          { error: "TOKEN_ROTATION_RECEIPT_NOT_FOUND" },
          { status: 404 }
        );
      }
      assert.equal(headers.get("x-casa-code"), LEGACY);
      assert.deepEqual(JSON.parse(String(init.body)), { mode: "migrate" });
      return Response.json({ token: CURRENT, casaId: 7, credentialVersion: 1 });
    });

    assert.equal(attempts, 2);
    assert.equal(result.token, CURRENT);
    assert.equal(storage.values.size, 1);
    const persisted = [...storage.values.values()][0];
    assert.equal(persisted.includes(LEGACY), false);
    assert.match(String(JSON.parse(persisted).sourceProof), /^[0-9a-f]{64}$/);
  });
});

test("token legado de 8 caracteres nunca ganha proof persistido", async () => {
  await withFixedUuid(async () => {
    const legacy8 = "2".repeat(8);
    const storage = new MemoryStorage();
    await assert.rejects(() =>
      requestTokenRotation(legacy8, "migrate", storage, async () => {
        throw new Error("response lost");
      })
    );
    const persisted = [...storage.values.values()][0];
    assert.equal(persisted.includes(legacy8), false);
    assert.equal("sourceProof" in JSON.parse(persisted), false);

    let attempts = 0;
    const result = await requestTokenRotation(legacy8, "migrate", storage, async (_input, init) => {
      attempts += 1;
      if (attempts === 1) {
        assert.equal(new Headers(init.headers).get("x-casa-code"), null);
        return Response.json(
          { error: "TOKEN_ROTATION_RECEIPT_NOT_FOUND" },
          { status: 404 }
        );
      }
      assert.equal(new Headers(init.headers).get("x-casa-code"), legacy8);
      return Response.json({ token: CURRENT, casaId: 7, credentialVersion: 1 });
    });
    assert.equal(result.token, CURRENT);
    assert.equal(attempts, 2, "a mesma aba conserva apenas o vínculo efêmero");
  });
});

test("ACK stale não apaga outra operação e login alheio não exige ACK global", async () => {
  const storage = new MemoryStorage();
  const stale: TokenRotationOperation = {
    mode: "rotate",
    operationId: UUID,
    verifier: "ab".repeat(32),
  };
  const current = { ...stale, operationId: "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb" };
  storage.setItem("repona:pending-token-rotation:rotate", JSON.stringify(current));
  acknowledgeTokenRotation(stale, storage);
  assert.equal(storage.values.size, 1);
  acknowledgeTokenRotation(current, storage);
  assert.equal(storage.values.size, 0);
});

test("payload/conflito e resposta malformada preservam operação sem persistir bearer", async () => {
  await withFixedUuid(async () => {
    const storage = new MemoryStorage();
    await assert.rejects(
      () => requestTokenRotation(LEGACY, "migrate", storage, async () =>
        Response.json({ token: LEGACY })
      ),
      (error: unknown) =>
        error instanceof TokenRotationError && error.code === "INVALID_SERVER_RESPONSE"
    );
    const before = [...storage.values.values()][0];
    assert.equal(before.includes(LEGACY), false);
    let calls = 0;
    await assert.rejects(
      () => requestTokenRotation("3".repeat(12), "migrate", storage, async (_input, init) => {
        calls += 1;
        assert.deepEqual(JSON.parse(String(init.body)), { mode: "recover" });
        return Response.json(
          { error: "TOKEN_ROTATION_RECEIPT_NOT_FOUND" },
          { status: 404 }
        );
      }),
      (error: unknown) =>
        error instanceof TokenRotationError && error.code === "PENDING_TOKEN_ROTATION"
    );
    assert.equal(calls, 1, "token B nunca recebe request regular com a operação de A");
    assert.equal([...storage.values.values()][0], before);
  });
});
