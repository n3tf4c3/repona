import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uuidv4,
  eventKey,
  productNameKey,
  matchProduct,
  shouldApplyIncoming,
  shouldApplyIncomingDeleted,
  sameSyncEvent,
  MAX_CLOCK_SKEW_MS,
  type ProductMatchMaps,
} from "./sync";

test("productNameKey: NFC unifica acento precomposto e combinante (auditoria #76)", () => {
  // Mesma palavra em duas formas Unicode, construidas por code point (fonte 100%
  // ASCII): precomposta (U+00E3) e decomposta (a + U+0303). Visualmente iguais,
  // bytes diferentes; apos NFC viram a mesma chave.
  const precomposto = "P" + String.fromCodePoint(0x00e3) + "o";
  const combinante = "Pa" + String.fromCodePoint(0x0303) + "o";
  assert.notEqual(precomposto, combinante);
  assert.equal(productNameKey(precomposto), productNameKey(combinante));
  // Continua baixando caixa e aparando espacos.
  assert.equal(productNameKey("  ARROZ  "), "arroz");
});

test("uuidv4: formato v4 (versão 4, variante 8/9/a/b)", () => {
  const id = uuidv4();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(uuidv4(), uuidv4());
});

const maps = (): ProductMatchMaps => ({
  idBySyncId: new Map([["sync-1", 10]]),
  idByName: new Map([["leite", 10], ["café", 20]]),
  idByBarcode: new Map([["789123", 30]]),
});

test("matchProduct: casa por syncId primeiro", () => {
  assert.deepEqual(matchProduct({ syncId: "sync-1", name: "Outro nome" }, maps()), {
    id: 10,
    matchedBy: "syncId",
  });
});

test("matchProduct: cai para o nome quando syncId não bate", () => {
  assert.deepEqual(matchProduct({ syncId: "sync-x", name: "Café" }, maps()), {
    id: 20,
    matchedBy: "name",
  });
});

test("matchProduct: cai para o nome quando syncId ausente (cliente legado)", () => {
  assert.deepEqual(matchProduct({ name: "Leite" }, maps()), { id: 10, matchedBy: "name" });
});

test("matchProduct: nenhum match retorna none", () => {
  assert.deepEqual(matchProduct({ syncId: "sync-x", name: "Novo" }, maps()), {
    id: null,
    matchedBy: "none",
  });
});

test("matchProduct: casa por barcode quando syncId não bate e nome diverge", () => {
  assert.deepEqual(
    matchProduct({ syncId: "sync-x", name: "Papel Toalha Absoluto", barcode: "789123" }, maps()),
    { id: 30, matchedBy: "barcode" }
  );
});

test("matchProduct: syncId vence o barcode", () => {
  assert.deepEqual(
    matchProduct({ syncId: "sync-1", name: "Outro", barcode: "789123" }, maps()),
    { id: 10, matchedBy: "syncId" }
  );
});

test("matchProduct: barcode ausente/nulo não casa (segue pelo nome)", () => {
  assert.deepEqual(matchProduct({ name: "Café", barcode: null }, maps()), {
    id: 20,
    matchedBy: "name",
  });
  // Dois itens sem código (NULL) nunca colidem por barcode.
  assert.deepEqual(matchProduct({ name: "Banana", barcode: "  " }, maps()), {
    id: null,
    matchedBy: "none",
  });
});

test("matchProduct: barcode desconhecido cai para o nome", () => {
  assert.deepEqual(matchProduct({ name: "Leite", barcode: "000000" }, maps()), {
    id: 10,
    matchedBy: "name",
  });
});

const t0 = "2026-06-08T10:00:00.000Z";
const t1 = "2026-06-08T11:00:00.000Z";

test("shouldApplyIncoming: recebido mais novo aplica", () => {
  assert.equal(shouldApplyIncoming(t1, t0), true);
});

test("shouldApplyIncoming: recebido mais antigo não aplica", () => {
  assert.equal(shouldApplyIncoming(t0, t1), false);
});

test("shouldApplyIncoming: empate não aplica (idempotente)", () => {
  assert.equal(shouldApplyIncoming(t0, t0), false);
});

test("shouldApplyIncoming: sem updatedAt (cliente legado) aplica", () => {
  assert.equal(shouldApplyIncoming(undefined, t0), true);
});

test("shouldApplyIncoming: data inválida aplica (não trava merge)", () => {
  assert.equal(shouldApplyIncoming("nao-e-data", t0), true);
});

test("shouldApplyIncoming: relógio muito no futuro é rejeitado", () => {
  const now = new Date("2026-06-08T12:00:00.000Z").getTime();
  const futuro = new Date(now + MAX_CLOCK_SKEW_MS + 1).toISOString();
  assert.equal(shouldApplyIncoming(futuro, t0, now), false);
});

test("sameSyncEvent: UUID distingue eventos idênticos e fallback preserva legado", () => {
  const legacyKey = eventKey("Arroz", t0, "1 un");
  assert.equal(
    sameSyncEvent(
      { syncId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", legacyKey },
      { syncId: "bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb", legacyKey },
    ),
    false,
  );
  assert.equal(
    sameSyncEvent(
      { syncId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", legacyKey },
      { syncId: null, legacyKey },
    ),
    true,
  );
});

test("shouldApplyIncomingDeleted: estados iguais não aplicam (idempotente)", () => {
  assert.equal(shouldApplyIncomingDeleted({ deleted: true, updatedAt: t1 }, { deleted: true, updatedAt: t0 }), false);
  assert.equal(shouldApplyIncomingDeleted({ deleted: false }, { deleted: false }), false);
});

test("shouldApplyIncomingDeleted: exclusão sem carimbo aplica (deleted vence)", () => {
  assert.equal(shouldApplyIncomingDeleted({ deleted: true }, { deleted: false }), true);
  assert.equal(shouldApplyIncomingDeleted({ deleted: true, updatedAt: null }, { deleted: false, updatedAt: null }), true);
});

test("shouldApplyIncomingDeleted: compra viva sem carimbo nunca ressuscita tombstone (cliente legado)", () => {
  assert.equal(shouldApplyIncomingDeleted({ deleted: false }, { deleted: true, updatedAt: t0 }), false);
  assert.equal(shouldApplyIncomingDeleted({ deleted: false, updatedAt: null }, { deleted: true, updatedAt: null }), false);
});

test("shouldApplyIncomingDeleted: re-inclusão carimbada mais nova vence o tombstone (un-delete, auditoria #65)", () => {
  assert.equal(shouldApplyIncomingDeleted({ deleted: false, updatedAt: t1 }, { deleted: true, updatedAt: t0 }), true);
});

test("shouldApplyIncomingDeleted: carimbo mais antigo não desfaz edição mais nova", () => {
  assert.equal(shouldApplyIncomingDeleted({ deleted: true, updatedAt: t0 }, { deleted: false, updatedAt: t1 }), false);
  assert.equal(shouldApplyIncomingDeleted({ deleted: false, updatedAt: t0 }, { deleted: true, updatedAt: t1 }), false);
});

test("shouldApplyIncomingDeleted: empate de carimbo não aplica (idempotente)", () => {
  assert.equal(shouldApplyIncomingDeleted({ deleted: true, updatedAt: t0 }, { deleted: false, updatedAt: t0 }), false);
});

test("shouldApplyIncomingDeleted: o lado carimbado vence o não-carimbado", () => {
  // Re-inclusão carimbada sobrevive a tombstone antigo sem carimbo…
  assert.equal(shouldApplyIncomingDeleted({ deleted: false, updatedAt: t1 }, { deleted: true, updatedAt: null }), true);
  // …e exclusão carimbada vence compra viva nunca editada.
  assert.equal(shouldApplyIncomingDeleted({ deleted: true, updatedAt: t1 }, { deleted: false, updatedAt: null }), true);
});

test("shouldApplyIncomingDeleted: carimbo inválido no recebido cai na regra conservadora", () => {
  assert.equal(shouldApplyIncomingDeleted({ deleted: true, updatedAt: "nao-e-data" }, { deleted: false, updatedAt: t0 }), true);
  assert.equal(shouldApplyIncomingDeleted({ deleted: false, updatedAt: "nao-e-data" }, { deleted: true, updatedAt: t0 }), false);
});
