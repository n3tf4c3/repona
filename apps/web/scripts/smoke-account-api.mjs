import { randomBytes, randomUUID } from "node:crypto";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3107";
const REQUEST_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 90_000;
const CURRENT_TOKEN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{26}$/;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

async function request(path, init) {
  const response = await fetch(new URL(path, BASE_URL), {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // A assercao do caller informa somente rota/status; nunca ecoamos o corpo.
  }
  return { response, body: asRecord(body) };
}

function expectStatus(result, expected, label) {
  invariant(
    result.response.status === expected,
    `${label}: HTTP ${result.response.status}, esperado ${expected}`,
  );
}

function expectNoToken(result, label) {
  invariant(!result.body || !("token" in result.body), `${label}: resposta rejeitada expos token`);
}

function operationHeaders(operationId, verifier) {
  return {
    "content-type": "application/json",
    "idempotency-key": operationId,
    "x-operation-verifier": verifier,
    "x-repona-client-version": "1.2.0",
  };
}

async function waitForServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL("/login", BASE_URL), {
        redirect: "manual",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // O servidor Next ainda pode estar compilando.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("servidor nao ficou pronto dentro do prazo");
}

async function tryCleanup(tokens) {
  for (const token of tokens) {
    if (!CURRENT_TOKEN.test(token)) continue;
    try {
      await request("/api/casa", {
        method: "DELETE",
        headers: {
          "idempotency-key": randomUUID(),
          "x-casa-code": token,
        },
      });
    } catch {
      // Cleanup best-effort; o teste principal preserva o erro original.
    }
  }
}

async function main() {
  const cleanupTokens = new Set();
  await waitForServer();

  try {
    const obsoleteClient = await request("/api/casa", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: JSON.stringify({ nome: "Smoke cliente antigo" }),
    });
    expectStatus(obsoleteClient, 426, "create cliente sem verifier");
    expectNoToken(obsoleteClient, "create cliente sem verifier");

    const createOperation = randomUUID();
    const createVerifier = randomBytes(32).toString("hex");
    const name = `Smoke API ${randomUUID().slice(0, 8)}`;
    const create = await request("/api/casa", {
      method: "POST",
      headers: operationHeaders(createOperation, createVerifier),
      body: JSON.stringify({ nome: name }),
    });
    expectStatus(create, 201, "create");
    invariant(create.body && typeof create.body.token === "string", "create: token ausente");
    invariant(CURRENT_TOKEN.test(create.body.token), "create: token fora do contrato atual");
    invariant(Number.isInteger(create.body.casaId) && create.body.casaId > 0, "create: casaId invalido");
    const originalToken = create.body.token;
    const casaId = create.body.casaId;
    cleanupTokens.add(originalToken);

    const createReplay = await request("/api/casa", {
      method: "POST",
      headers: operationHeaders(createOperation, createVerifier),
      body: JSON.stringify({ nome: name }),
    });
    expectStatus(createReplay, 201, "create replay");
    invariant(
      createReplay.body?.token === originalToken && createReplay.body?.casaId === casaId,
      "create replay: resultado nao deterministico",
    );

    const createWrongVerifier = await request("/api/casa", {
      method: "POST",
      headers: operationHeaders(createOperation, randomBytes(32).toString("hex")),
      body: JSON.stringify({ nome: name }),
    });
    expectStatus(createWrongVerifier, 409, "create verifier incorreto");
    expectNoToken(createWrongVerifier, "create verifier incorreto");

    const v1RequestId = randomUUID();
    const v1Snapshot = await request("/api/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-casa-code": originalToken,
        "x-repona-sync-protocol": "1",
        "x-repona-client-version": "1.1.0",
        "x-request-id": v1RequestId,
      },
      body: JSON.stringify({
        products: [],
        purchases: [],
        consumptions: [],
        prices: [],
        listItems: [],
      }),
    });
    expectStatus(v1Snapshot, 200, "sync v1 vazio");
    invariant(
      v1Snapshot.response.headers.get("x-repona-sync-protocol") === "1",
      "sync v1 vazio: protocolo de resposta divergente",
    );
    invariant(
      v1Snapshot.response.headers.get("x-request-id") === v1RequestId,
      "sync v1 vazio: request ID nao foi preservado",
    );
    invariant(v1Snapshot.body?.casaId === casaId, "sync v1 vazio: casa divergente");

    const requestIdBeforeRotation = randomUUID();
    const firstDownload = await request("/api/sync/v2", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-casa-code": originalToken,
        "x-repona-sync-protocol": "2",
        "x-repona-client-version": "1.2.0",
        "x-request-id": requestIdBeforeRotation,
      },
      body: JSON.stringify({
        protocolVersion: 2,
        phase: "download",
        cursor: null,
        expectedCasaId: casaId,
      }),
    });
    expectStatus(firstDownload, 200, "sync v2 inicial");
    invariant(
      firstDownload.response.headers.get("x-request-id") === requestIdBeforeRotation,
      "sync v2 inicial: request ID nao foi preservado",
    );
    invariant(firstDownload.body?.casaId === casaId, "sync v2 inicial: casa divergente");

    const rotateOperation = randomUUID();
    const rotateVerifier = randomBytes(32).toString("hex");
    const rotate = await request("/api/casa", {
      method: "PATCH",
      headers: {
        ...operationHeaders(rotateOperation, rotateVerifier),
        "x-casa-code": originalToken,
      },
      body: JSON.stringify({ mode: "rotate" }),
    });
    expectStatus(rotate, 200, "rotate");
    invariant(rotate.body && typeof rotate.body.token === "string", "rotate: token ausente");
    invariant(CURRENT_TOKEN.test(rotate.body.token), "rotate: token fora do contrato atual");
    invariant(rotate.body.token !== originalToken, "rotate: token nao mudou");
    invariant(rotate.body.casaId === casaId, "rotate: casa divergente");
    const currentToken = rotate.body.token;
    cleanupTokens.add(currentToken);

    const recover = await request("/api/casa", {
      method: "PATCH",
      headers: operationHeaders(rotateOperation, rotateVerifier),
      body: JSON.stringify({ mode: "recover" }),
    });
    expectStatus(recover, 200, "recover");
    invariant(
      recover.body?.token === currentToken && recover.body?.casaId === casaId,
      "recover: recibo nao deterministico",
    );

    const wrongRecovery = await request("/api/casa", {
      method: "PATCH",
      headers: operationHeaders(rotateOperation, randomBytes(32).toString("hex")),
      body: JSON.stringify({ mode: "recover" }),
    });
    expectStatus(wrongRecovery, 404, "recover verifier incorreto");
    expectNoToken(wrongRecovery, "recover verifier incorreto");

    const retiredRequestId = randomUUID();
    const retiredToken = await request("/api/sync/v2", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-casa-code": originalToken,
        "x-repona-sync-protocol": "2",
        "x-repona-client-version": "1.2.0",
        "x-request-id": retiredRequestId,
      },
      body: JSON.stringify({ protocolVersion: 2, phase: "download", cursor: null }),
    });
    expectStatus(retiredToken, 404, "token aposentado");
    invariant(
      retiredToken.response.headers.get("x-request-id") === retiredRequestId,
      "token aposentado: request ID nao foi preservado",
    );

    const currentDownload = await request("/api/sync/v2", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-casa-code": currentToken,
        "x-repona-sync-protocol": "2",
        "x-repona-client-version": "1.2.0",
      },
      body: JSON.stringify({
        protocolVersion: 2,
        phase: "download",
        cursor: null,
        expectedCasaId: casaId,
      }),
    });
    expectStatus(currentDownload, 200, "sync v2 apos rotate");

    const deleteOperation = randomUUID();
    const remove = await request("/api/casa", {
      method: "DELETE",
      headers: {
        "idempotency-key": deleteOperation,
        "x-casa-code": currentToken,
      },
    });
    expectStatus(remove, 200, "delete");
    invariant(remove.body?.ok === true, "delete: confirmacao ausente");

    const deleteReplay = await request("/api/casa", {
      method: "DELETE",
      headers: {
        "idempotency-key": deleteOperation,
        "x-casa-code": currentToken,
      },
    });
    expectStatus(deleteReplay, 200, "delete replay");
    invariant(deleteReplay.body?.ok === true, "delete replay: confirmacao ausente");

    const deletedAccount = await request("/api/sync/v2", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-casa-code": currentToken,
        "x-repona-sync-protocol": "2",
        "x-repona-client-version": "1.2.0",
      },
      body: JSON.stringify({ protocolVersion: 2, phase: "download", cursor: null }),
    });
    expectStatus(deletedAccount, 404, "conta excluida");

    console.log("Smoke HTTP de conta/sync: PASS (upgrade gate, create, replay, verifier, sync v1/v2, rotate, recover, delete)");
  } finally {
    await tryCleanup(cleanupTokens);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "falha desconhecida";
  console.error(`Smoke HTTP de conta/sync: FAIL (${message})`);
  process.exitCode = 1;
});
