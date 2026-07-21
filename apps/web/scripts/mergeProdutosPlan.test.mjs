import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  construirPlanoMerge,
  escolherEstadoMaisRecente,
  planejarItensLista,
  resumirEventos,
} from "./mergeProdutosPlan.mjs";
import {
  CASA_MUTATION_LOCK_NAMESPACE,
  casaMutationLockStatement,
} from "../casa-mutation-lock.mjs";
import {
  construirExpectativaMerge,
  mergeConcurrencyGuardStatement,
} from "./mergeProdutosConcurrency.mjs";

test("merge CLI resolve nome pela chave persistida do core", () => {
  const source = readFileSync(new URL("./merge-produtos.mjs", import.meta.url), "utf8");
  assert.match(source, /name_key\s*=\s*\$\{productNameKey\(ref\)\}/);
  assert.doesNotMatch(source, /lower\(normalize\(btrim\(name\)/);
});

test("merge CLI usa o mesmo mutex advisory transacional do runtime", () => {
  const fakeSql = (strings, ...values) => ({ strings: [...strings], values });
  const statement = casaMutationLockStatement(fakeSql, 42);
  assert.deepEqual(statement.values, [CASA_MUTATION_LOCK_NAMESPACE, 42]);
  assert.match(statement.strings.join("?"), /pg_advisory_xact_lock/);
});

test("merge CLI leva expectativa otimista para a transacao de apply", () => {
  const expectation = construirExpectativaMerge({
    products: [
      {
        id: 1,
        sync_id: "00000000-0000-4000-8000-000000000001",
        name: "Arroz",
        category: "Mercearia",
        brand: null,
        barcode: null,
        photo_uri: null,
        purchase_count: 3,
        status: "active",
        alert_threshold: null,
        archived: false,
        occasional: true,
        updated_at: "2026-01-01T00:00:00.123Z",
      },
    ],
    inventoryItems: [
      {
        product_id: 1,
        quantity: "2 un",
        status: "in_stock",
        updated_at: "2026-01-01T00:00:00.456Z",
      },
    ],
    listItems: [
      {
        id: 3,
        product_id: 1,
        quantity: "1 un",
        checked: false,
        deleted: false,
        updated_at: "2026-01-01T00:00:00.789Z",
      },
    ],
  });
  const fakeSql = (strings, ...values) => ({ strings: [...strings], values });
  const statement = mergeConcurrencyGuardStatement(fakeSql, 9, expectation);
  assert.match(statement.strings.join("?"), /merge_concurrency_guard/);
  assert.ok(statement.values.some((value) => String(value).includes('"quantity":"2 un"')));
  assert.ok(statement.values.some((value) => String(value).includes('"occasional":true')));
});

test("lista escolhe o estado mais novo e preserva tombstone no empate", () => {
  const rows = [
    {
      id: 1,
      shopping_list_id: 7,
      list_name: "Mensal",
      list_status: "active",
      product_id: 10,
      quantity: "1 un",
      checked: false,
      deleted: false,
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: 2,
      shopping_list_id: 7,
      list_name: "Mensal",
      list_status: "active",
      product_id: 20,
      quantity: "2 un",
      checked: true,
      deleted: true,
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ];

  const [decision] = planejarItensLista(rows, 10, 20);
  assert.equal(decision.action, "reconcile");
  assert.equal(decision.winnerSource, "duplicate");
  assert.equal(decision.result.deleted, true);
});

test("estoque mais recente vence; empate mantém o canônico", () => {
  const canonical = { updated_at: "2026-01-02T00:00:00.000Z", quantity: "1 un" };
  const duplicate = { updated_at: "2026-01-03T00:00:00.000Z", quantity: "4 un" };
  assert.equal(escolherEstadoMaisRecente(canonical, duplicate).row.quantity, "4 un");
  assert.equal(
    escolherEstadoMaisRecente(canonical, { ...duplicate, updated_at: canonical.updated_at }).row
      .quantity,
    "1 un"
  );
});

test("eventos iguais no conteúdo com UUIDs distintos não são deduplicados", () => {
  const events = [
    { product_id: 10, sync_id: "uuid-a", quantity: "1 un", occurred_at: "same" },
    { product_id: 20, sync_id: "uuid-b", quantity: "1 un", occurred_at: "same" },
    { product_id: 20, sync_id: null, quantity: "1 un", occurred_at: "same" },
  ];
  assert.deepEqual(resumirEventos(events, 10, 20), {
    canonical: 1,
    duplicate: 2,
    legacyIdsToAssign: 1,
    stableIdReplays: 0,
    preserved: 3,
  });
});
test("plano conta somente compras vivas e descreve alias", () => {
  const canonical = { id: 10, sync_id: "canonical" };
  const duplicate = { id: 20, sync_id: "duplicate" };
  const plan = construirPlanoMerge({
    canonical,
    duplicate,
    purchases: [
      { product_id: 10, sync_id: "purchase-a", deleted: false },
      { product_id: 20, sync_id: "purchase-b", deleted: true },
    ],
    prices: [],
    inventoryEvents: [],
    inventoryItems: [],
    listItems: [],
    aliasesPointingToDuplicate: 2,
  });

  assert.equal(plan.purchases.live, 1);
  assert.equal(plan.purchases.tombstones, 1);
  assert.equal(plan.purchases.finalPurchaseCount, 1);
  assert.deepEqual(plan.aliases, {
    repoint: 2,
    create: { oldSyncId: "duplicate", canonicalProductId: 10 },
  });
});
