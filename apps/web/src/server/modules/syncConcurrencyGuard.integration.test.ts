import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { productNameKey } from "@repona/core";
import { buildCasaMutationLock } from "./casaMutationLock";
import {
  buildSyncConcurrencyGuard,
  isSyncConcurrentUniqueViolation,
  isSyncConcurrencyGuardViolation,
  type SyncConcurrencyExpectation,
} from "./syncConcurrencyGuard";
import {
  CONSUME_DOMAIN_OPERATION_SQL,
  FINALIZE_PURCHASE_OPERATION_SQL,
} from "./domainMutationSql";
import {
  construirExpectativaMerge,
  isMergeConcurrencyViolation,
  mergeConcurrencyGuardStatement,
} from "../../../scripts/mergeProdutosConcurrency.mjs";

const databaseUrl = process.env.TEST_DATABASE_URL;
const dialect = new PgDialect();

async function executeDrizzleSql(client: PoolClient, query: SQL): Promise<void> {
  const compiled = dialect.sqlToQuery(query);
  await client.query(compiled.sql, compiled.params);
}

async function beginGuarded(
  pool: Pool,
  casaId: number,
  expectation: SyncConcurrencyExpectation
): Promise<PoolClient> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '5s'");
    await executeDrizzleSql(client, buildCasaMutationLock(casaId));
    await executeDrizzleSql(client, buildSyncConcurrencyGuard(casaId, expectation));
    return client;
  } catch (error) {
    await client.query("rollback");
    client.release();
    throw error;
  }
}

async function captureExpectation(
  pool: Pool,
  casaId: number,
  productIds: number[],
  activeList = false
): Promise<SyncConcurrencyExpectation> {
  const products = await pool.query<{
    id: number;
    syncId: string;
    name: string;
    category: string;
    brand: string | null;
    barcode: string | null;
    photoUri: string | null;
    purchaseCount: number;
    status: string;
    alertThreshold: string | null;
    archived: boolean;
    occasional: boolean;
    updatedAt: Date;
  }>(
    `select
       id,
       sync_id as "syncId",
       name,
       category,
       brand,
       barcode,
       photo_uri as "photoUri",
       purchase_count as "purchaseCount",
       status,
       alert_threshold as "alertThreshold",
       archived,
       occasional,
       updated_at as "updatedAt"
     from products where casa_id = $1 and id = any($2::int[]) order by id`,
    [casaId, productIds]
  );
  const inventories = await pool.query<{
    productId: number;
    quantity: string;
    status: string;
    updatedAt: Date;
  }>(
    `select product_id as "productId", quantity, status, updated_at as "updatedAt"
     from inventory_items where product_id = any($1::int[]) order by product_id`,
    [productIds]
  );
  const expectation: SyncConcurrencyExpectation = {
    products: products.rows.map((row) => ({
      id: row.id,
      syncId: row.syncId,
      name: row.name,
      category: row.category,
      brand: row.brand,
      barcode: row.barcode,
      photoUri: row.photoUri,
      purchaseCount: row.purchaseCount,
      status: row.status,
      alertThreshold: row.alertThreshold,
      archived: row.archived,
      occasional: row.occasional,
      updatedAt: row.updatedAt.toISOString(),
    })),
    inventories: inventories.rows.map((row) => ({
      productId: row.productId,
      quantity: row.quantity,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
  if (!activeList) return expectation;

  const list = await pool.query<{
    id: number;
    name: string;
    status: string;
    updatedAt: Date;
  }>(
    `select id, name, status, updated_at as "updatedAt"
     from shopping_lists where casa_id = $1 and status = 'active' order by id limit 1`,
    [casaId]
  );
  assert.equal(list.rowCount, 1);
  const currentList = list.rows[0];
  const items = await pool.query<{
    productId: number;
    quantity: string;
    checked: boolean;
    deleted: boolean;
    updatedAt: Date;
  }>(
    `select product_id as "productId", quantity, checked, deleted,
            updated_at as "updatedAt"
     from shopping_list_items
     where shopping_list_id = $1 and product_id = any($2::int[])
     order by product_id`,
    [currentList.id, productIds]
  );
  expectation.activeList = {
    id: currentList.id,
    name: currentList.name,
    status: currentList.status,
    updatedAt: currentList.updatedAt.toISOString(),
    relevantProductIds: productIds,
    items: items.rows.map((row) => ({
      productId: row.productId,
      quantity: row.quantity,
      checked: row.checked,
      deleted: row.deleted,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
  return expectation;
}

async function assertStillPending(promise: Promise<unknown>): Promise<void> {
  const state = await Promise.race([
    promise.then(
      () => "settled",
      () => "settled"
    ),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 100)),
  ]);
  assert.equal(state, "pending");
}

async function runDomainWithMutex(
  pool: Pool,
  casaId: number,
  query: string,
  params: unknown[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await executeDrizzleSql(client, buildCasaMutationLock(casaId));
    // Statement separado e posterior ao wait: em READ COMMITTED ele recebe um
    // snapshot novo, incluindo o commit que liberou o advisory.
    await client.query(query, params);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function pgParameterizedTag(strings: TemplateStringsArray, ...values: unknown[]) {
  return {
    text: strings.reduce(
      (query, part, index) => query + part + (index < values.length ? `$${index + 1}` : ""),
      ""
    ),
    values,
  };
}

test(
  "Postgres: mutex+guard serializam sync contra consumo, finalizacao e edicoes",
  { skip: !databaseUrl, timeout: 30_000 },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 8 });
    let casaId: number | null = null;
    try {
      const casa = await pool.query<{ id: number }>(
        `insert into casas (name, invite_code_enc)
         values ('Integracao sync #74', $1) returning id`,
        [`test:${randomUUID()}`]
      );
      casaId = casa.rows[0].id;
      const createdProducts = await pool.query<{ id: number }>(
        `insert into products (casa_id, name, name_key, category, status, updated_at)
         values
           ($1, 'Arroz guard', $2, 'Mercearia', 'active', '2026-01-01 00:00:00.123456+00'),
           ($1, 'Feijao sem saldo', $3, 'Mercearia', 'missing', '2026-01-01 00:00:00.654321+00')
         returning id`,
        [casaId, productNameKey("Arroz guard"), productNameKey("Feijao sem saldo")]
      );
      const [productA, productWithoutInventory] = createdProducts.rows.map((row) => row.id);
      await pool.query(
        `insert into inventory_items (product_id, quantity, status, updated_at)
         values ($1, '5 un', 'in_stock', '2026-01-01 00:00:00.987654+00')`,
        [productA]
      );
      const list = await pool.query<{ id: number }>(
        `insert into shopping_lists (casa_id, name, status, updated_at)
         values ($1, 'Lista guard', 'active', '2026-01-01 00:00:00.456789+00')
         returning id`,
        [casaId]
      );
      await pool.query(
        `insert into shopping_list_items
          (casa_id, shopping_list_id, product_id, quantity, checked, deleted, updated_at)
         values ($1, $2, $3, '2 un', true, false, '2026-01-01 00:00:00.321987+00')`,
        [casaId, list.rows[0].id, productA]
      );

      // O driver JS perde microssegundos. Sem mutacao, truncar ambos os lados a
      // milissegundos deve aceitar exatamente o estado que foi lido.
      const precise = await captureExpectation(pool, casaId, [productA], true);
      const preciseClient = await beginGuarded(pool, casaId, precise);
      await preciseClient.query("rollback");
      preciseClient.release();

      // updated_at nao e uma versao CAS: duas escritas podem conservar o mesmo
      // relogio (ou cair no mesmo ms). O conteudo mutavel tambem precisa fazer o
      // guard abortar.
      const sameClockEdit = await captureExpectation(pool, casaId, [productA]);
      const exactUpdatedAt = sameClockEdit.products[0].updatedAt;
      await pool.query(
        `update products set category = 'Editado sem tocar relogio'
         where id = $1`,
        [productA]
      );
      const clockAfterEdit = await pool.query<{ updatedAt: Date }>(
        `select updated_at as "updatedAt" from products where id = $1`,
        [productA]
      );
      assert.equal(clockAfterEdit.rows[0].updatedAt.toISOString(), exactUpdatedAt);
      const sameClockClient = await pool.connect();
      await sameClockClient.query("begin");
      await executeDrizzleSql(sameClockClient, buildCasaMutationLock(casaId));
      await assert.rejects(
        executeDrizzleSql(
          sameClockClient,
          buildSyncConcurrencyGuard(casaId, sameClockEdit)
        ),
        (error) => isSyncConcurrencyGuardViolation(error)
      );
      await sameClockClient.query("rollback");
      sameClockClient.release();

      // Edicao que commitou depois dos reads e antes do guard invalida o plano.
      const beforeEdit = await captureExpectation(pool, casaId, [productA], true);
      await pool.query(
        `update products set name = 'Arroz editado antes', name_key = $2,
             updated_at = updated_at + interval '1 second'
         where id = $1`,
        [productA, productNameKey("Arroz editado antes")]
      );
      const staleClient = await pool.connect();
      await staleClient.query("begin");
      await executeDrizzleSql(staleClient, buildCasaMutationLock(casaId));
      await assert.rejects(
        executeDrizzleSql(staleClient, buildSyncConcurrencyGuard(casaId, beforeEdit)),
        (error) => isSyncConcurrencyGuardViolation(error)
      );
      await staleClient.query("rollback");
      staleClient.release();

      // Trocar a lista ativa tambem invalida a expectativa, ainda que os itens
      // tenham os mesmos produtos.
      const beforeListSwap = await captureExpectation(pool, casaId, [productA], true);
      await pool.query(
        `update shopping_lists set status = 'archived', updated_at = now() where id = $1`,
        [beforeListSwap.activeList?.id]
      );
      const newList = await pool.query<{ id: number }>(
        `insert into shopping_lists (casa_id, name, status) values ($1, 'Nova ativa', 'active')
         returning id`,
        [casaId]
      );
      await pool.query(
        `insert into shopping_list_items
          (casa_id, shopping_list_id, product_id, quantity, checked, deleted)
         values ($1, $2, $3, '2 un', true, false)`,
        [casaId, newList.rows[0].id, productA]
      );
      const swappedClient = await pool.connect();
      await swappedClient.query("begin");
      await executeDrizzleSql(swappedClient, buildCasaMutationLock(casaId));
      await assert.rejects(
        executeDrizzleSql(swappedClient, buildSyncConcurrencyGuard(casaId, beforeListSwap)),
        (error) => isSyncConcurrencyGuardViolation(error)
      );
      await swappedClient.query("rollback");
      swappedClient.release();

      // Finalizacao que ganhou o mutex antes do guard muda item+saldo; o plano
      // lido anteriormente nao recebe ACK e nao pode restaurar esses valores.
      const beforeFinalize = await captureExpectation(pool, casaId, [productA], true);
      await runDomainWithMutex(pool, casaId, FINALIZE_PURCHASE_OPERATION_SQL, [
          randomUUID(),
          casaId,
          list.rows[0].id,
          "Lista guard",
        ]);
      const purchaseSource = await pool.query<{ sourceListId: number }>(
        `select source_list_id as "sourceListId"
         from purchase_history where casa_id = $1 order by id desc limit 1`,
        [casaId]
      );
      assert.equal(purchaseSource.rows[0].sourceListId, newList.rows[0].id);
      const finalizedClient = await pool.connect();
      await finalizedClient.query("begin");
      await executeDrizzleSql(finalizedClient, buildCasaMutationLock(casaId));
      await assert.rejects(
        executeDrizzleSql(finalizedClient, buildSyncConcurrencyGuard(casaId, beforeFinalize)),
        (error) => isSyncConcurrencyGuardViolation(error)
      );
      await finalizedClient.query("rollback");
      finalizedClient.release();

      // Consumo iniciado depois do guard espera o mutex. Ao acordar, decrementa
      // o saldo 6 gravado pelo sync, produzindo 5 (nao e sobrescrito para 6).
      await pool.query(
        `update inventory_items set quantity = '5 un', status = 'in_stock', updated_at = now()
         where product_id = $1`,
        [productA]
      );
      const beforeConsume = await captureExpectation(pool, casaId, [productA]);
      const syncClient = await beginGuarded(pool, casaId, beforeConsume);
      const consume = runDomainWithMutex(pool, casaId, CONSUME_DOMAIN_OPERATION_SQL, [
        randomUUID(),
        casaId,
        productA,
      ]);
      await assertStillPending(consume);
      await syncClient.query(
        `update inventory_items set quantity = '6 un', status = 'in_stock', updated_at = now()
         where product_id = $1`,
        [productA]
      );
      await syncClient.query("commit");
      syncClient.release();
      await consume;
      const afterConsume = await pool.query<{ quantity: string }>(
        `select quantity from inventory_items where product_id = $1`,
        [productA]
      );
      assert.equal(afterConsume.rows[0].quantity, "5 un");

      // Produto sem inventory e definirQuantidade concorrente: o insert espera o
      // advisory, depois aplica sobre o commit do sync, sem deadlock/overwrite.
      const absentInventory = await captureExpectation(pool, casaId, [productWithoutInventory]);
      assert.equal(absentInventory.inventories.length, 0);
      const absentClient = await beginGuarded(pool, casaId, absentInventory);
      const defineLater = (async () => {
        const client = await pool.connect();
        try {
          await client.query("begin");
          await executeDrizzleSql(client, buildCasaMutationLock(casaId as number));
          await client.query(
            `insert into inventory_items (product_id, quantity, status, updated_at)
             values ($1, '4 un', 'in_stock', now())
             on conflict (product_id) do update set
               quantity = excluded.quantity,
               status = excluded.status,
               updated_at = excluded.updated_at`,
            [productWithoutInventory]
          );
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
      })();
      await assertStillPending(defineLater);
      await absentClient.query(
        `insert into inventory_items (product_id, quantity, status, updated_at)
         values ($1, '7 un', 'in_stock', now())`,
        [productWithoutInventory]
      );
      await absentClient.query("commit");
      absentClient.release();
      await defineLater;
      const afterDefine = await pool.query<{ quantity: string }>(
        `select quantity from inventory_items where product_id = $1`,
        [productWithoutInventory]
      );
      assert.equal(afterDefine.rows[0].quantity, "4 un");

      // Uma edicao de produto que comeca apos o guard tambem espera; quando o
      // sync libera o mutex, a acao mais nova do usuario vence normalmente.
      const beforeRename = await captureExpectation(pool, casaId, [productA]);
      const renameClient = await beginGuarded(pool, casaId, beforeRename);
      const renameLater = (async () => {
        const client = await pool.connect();
        try {
          await client.query("begin");
          await executeDrizzleSql(client, buildCasaMutationLock(casaId as number));
          await client.query(
            `update products set name = 'Arroz editado depois', name_key = $2,
                updated_at = now() where id = $1`,
            [productA, productNameKey("Arroz editado depois")]
          );
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
      })();
      await assertStillPending(renameLater);
      await renameClient.query(
        `update products set category = 'Sync', updated_at = now() where id = $1`,
        [productA]
      );
      await renameClient.query("commit");
      renameClient.release();
      await renameLater;
      const renamed = await pool.query<{ name: string }>(
        `select name from products where id = $1`,
        [productA]
      );
      assert.equal(renamed.rows[0].name, "Arroz editado depois");

      // O CLI calcula o plano antes da confirmacao. Uma edicao de produto entre
      // plan/apply precisa ser rejeitada mesmo preservando exatamente o relogio.
      const cliProducts = await pool.query(
        `select * from products where casa_id = $1 and id = any($2::int[]) order by id`,
        [casaId, [productA, productWithoutInventory]]
      );
      const cliInventories = await pool.query(
        `select * from inventory_items where product_id = any($1::int[]) order by product_id`,
        [[productA, productWithoutInventory]]
      );
      const cliListItems = await pool.query(
        `select * from shopping_list_items where product_id = any($1::int[]) order by id`,
        [[productA, productWithoutInventory]]
      );
      const cliExpectation = construirExpectativaMerge({
        products: cliProducts.rows,
        inventoryItems: cliInventories.rows,
        listItems: cliListItems.rows,
      });
      const cliProductBefore = cliProducts.rows.find(
        (row) => Number(row.id) === productA
      ) as { updated_at: Date };
      await pool.query(
        `update products set occasional = not occasional where id = $1`,
        [productA]
      );
      const cliClockAfter = await pool.query<{ updatedAt: Date }>(
        `select updated_at as "updatedAt" from products where id = $1`,
        [productA]
      );
      assert.equal(
        cliClockAfter.rows[0].updatedAt.toISOString(),
        cliProductBefore.updated_at.toISOString()
      );
      const cliClient = await pool.connect();
      await cliClient.query("begin");
      await executeDrizzleSql(cliClient, buildCasaMutationLock(casaId));
      const cliGuard = mergeConcurrencyGuardStatement(
        pgParameterizedTag,
        casaId,
        cliExpectation
      ) as { text: string; values: unknown[] };
      await assert.rejects(
        cliClient.query(cliGuard.text, cliGuard.values),
        (error) => isMergeConcurrencyViolation(error)
      );
      await cliClient.query("rollback");
      cliClient.release();

      // Phantom de produto que apareceu apos o read mas antes do guard: nao ha
      // ID para bloquear, entao o indice NFC e a segunda linha de defesa. O
      // merge converte apenas essa 23505 conhecida em conflito retryable.
      await runDomainWithMutex(
        pool,
        casaId,
        `insert into products (casa_id, name, name_key, category, status)
         values ($1, 'Phantom antes', $2, 'Teste', 'missing')`,
        [casaId, productNameKey("Phantom antes")]
      );
      const phantomBefore = await beginGuarded(pool, casaId, {
        products: [],
        inventories: [],
      });
      await assert.rejects(
        phantomBefore.query(
          `insert into products (casa_id, name, name_key, category, status)
           values ($1, '  PHANTOM ANTES  ', $2, 'Teste', 'missing')`,
          [casaId, productNameKey("  PHANTOM ANTES  ")]
        ),
        (error) => isSyncConcurrentUniqueViolation(error)
      );
      await phantomBefore.query("rollback");
      phantomBefore.release();

      // Se o create comeca depois, espera o mutex. O sync insere primeiro; ao
      // acordar, o create recebe UNIQUE e nunca surgem duas identidades.
      const phantomAfter = await beginGuarded(pool, casaId, {
        products: [],
        inventories: [],
      });
      const createAfter = runDomainWithMutex(
        pool,
        casaId,
        `insert into products (casa_id, name, name_key, category, status)
         values ($1, 'phantom depois', $2, 'Teste', 'missing')`,
        [casaId, productNameKey("phantom depois")]
      );
      await assertStillPending(createAfter);
      await phantomAfter.query(
        `insert into products (casa_id, name, name_key, category, status)
         values ($1, 'Phantom Depois', $2, 'Teste', 'missing')`,
        [casaId, productNameKey("Phantom Depois")]
      );
      await phantomAfter.query("commit");
      phantomAfter.release();
      await assert.rejects(createAfter, (error: unknown) => {
        return (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === "23505"
        );
      });
      const phantomCount = await pool.query<{ count: string }>(
        `select count(*) from products
         where casa_id = $1 and name_key = $2`,
        [casaId, productNameKey("phantom depois")]
      );
      assert.equal(Number(phantomCount.rows[0].count), 1);
    } finally {
      if (casaId !== null) {
        await pool.query(`delete from purchase_history where casa_id = $1`, [casaId]);
        await pool.query(`delete from shopping_list_items where casa_id = $1`, [casaId]);
        await pool.query(
          `delete from inventory_events
           where product_id in (select id from products where casa_id = $1)`,
          [casaId]
        );
        await pool.query(
          `delete from inventory_items
           where product_id in (select id from products where casa_id = $1)`,
          [casaId]
        );
        await pool.query(`delete from product_sync_aliases where casa_id = $1`, [casaId]);
        await pool.query(`delete from products where casa_id = $1`, [casaId]);
        await pool.query(`delete from shopping_lists where casa_id = $1`, [casaId]);
        await pool.query(`delete from domain_operations where casa_id = $1`, [casaId]);
        await pool.query(`delete from casas where id = $1`, [casaId]);
      }
      await pool.end();
    }
  }
);
