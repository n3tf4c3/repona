import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { Pool, type PoolClient } from "pg";
import { CASA_MUTATION_LOCK_NAMESPACE } from "./casaMutationLock";
import {
  buildSyncDownloadHighWaterQuery,
  syncDownloadHighWaterFromRow,
  type SyncDownloadHighWaterRow,
} from "./syncDownloadHighWater";

const databaseUrl = process.env.TEST_DATABASE_URL;
const dialect = new PgDialect();

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

async function acquireCasaMutationLock(client: PoolClient, casaId: number): Promise<void> {
  await client.query("select pg_advisory_xact_lock($1::int, $2::int)", [
    CASA_MUTATION_LOCK_NAMESPACE,
    casaId,
  ]);
}

async function insertSyncBundle(
  client: PoolClient,
  casaId: number,
  label: string,
  activeListId?: number
): Promise<{
  productId: number;
  purchaseId: number;
  consumptionId: number;
  priceId: number;
  listItemId: number;
  activeListId: number;
}> {
  const product = await client.query<{ id: number }>(
    `insert into products (casa_id, name, category, status)
     values ($1, $2, 'Teste', 'active') returning id`,
    [casaId, `Produto high-water ${label}`]
  );
  const productId = product.rows[0].id;
  let listId = activeListId;
  if (listId === undefined) {
    const list = await client.query<{ id: number }>(
      `insert into shopping_lists (casa_id, name, status)
       values ($1, 'Lista high-water', 'active') returning id`,
      [casaId]
    );
    listId = list.rows[0].id;
  }
  const purchase = await client.query<{ id: number }>(
    `insert into purchase_history
       (sync_id, casa_id, product_id, quantity, source_list_id, source_list_name)
     values ($1, $2, $3, '1 un', $4, 'Lista high-water') returning id`,
    [randomUUID(), casaId, productId, listId]
  );
  const consumption = await client.query<{ id: number }>(
    `insert into inventory_events (sync_id, product_id, event_type, quantity)
     values ($1, $2, 'consumed', '1 un') returning id`,
    [randomUUID(), productId]
  );
  const price = await client.query<{ id: number }>(
    `insert into price_history (sync_id, product_id, price_cents)
     values ($1, $2, 1234) returning id`,
    [randomUUID(), productId]
  );
  const listItem = await client.query<{ id: number }>(
    `insert into shopping_list_items
       (casa_id, shopping_list_id, product_id, quantity, checked, deleted)
     values ($1, $2, $3, '1 un', false, false) returning id`,
    [casaId, listId, productId]
  );
  return {
    productId,
    purchaseId: purchase.rows[0].id,
    consumptionId: consumption.rows[0].id,
    priceId: price.rows[0].id,
    listItemId: listItem.rows[0].id,
    activeListId: listId,
  };
}

test(
  "Postgres: high-water espera writer e delimita um download referencialmente fechado",
  { skip: !databaseUrl, timeout: 20_000 },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    let casaId: number | null = null;
    let writer: PoolClient | null = null;
    let capture: PoolClient | null = null;
    let laterWriter: PoolClient | null = null;
    try {
      const casa = await pool.query<{ id: number }>(
        `insert into casas (name, invite_code_enc)
         values ('Integracao high-water', $1) returning id`,
        [`test:${randomUUID()}`]
      );
      casaId = casa.rows[0].id;

      writer = await pool.connect();
      await writer.query("begin");
      await acquireCasaMutationLock(writer, casaId);
      const included = await insertSyncBundle(writer, casaId, "incluido");

      capture = await pool.connect();
      await capture.query("begin");
      await capture.query("set local lock_timeout = '5s'");
      const captureLock = acquireCasaMutationLock(capture, casaId);
      await assertStillPending(captureLock);

      await writer.query("commit");
      writer.release();
      writer = null;
      await captureLock;

      const compiled = dialect.sqlToQuery(buildSyncDownloadHighWaterQuery(casaId));
      const capturedRows = await capture.query<SyncDownloadHighWaterRow>(
        compiled.sql,
        compiled.params
      );
      const marks = syncDownloadHighWaterFromRow(capturedRows.rows[0]);
      assert.deepEqual(marks, {
        products: included.productId,
        purchases: included.purchaseId,
        consumptions: included.consumptionId,
        prices: included.priceId,
        listItems: included.listItemId,
        activeListId: included.activeListId,
      });
      await capture.query("commit");
      capture.release();
      capture = null;

      laterWriter = await pool.connect();
      await laterWriter.query("begin");
      await acquireCasaMutationLock(laterWriter, casaId);
      const deferred = await insertSyncBundle(
        laterWriter,
        casaId,
        "proxima-sessao",
        included.activeListId
      );
      await laterWriter.query("commit");
      laterWriter.release();
      laterWriter = null;

      assert.ok(deferred.productId > marks.products);
      assert.ok(deferred.purchaseId > marks.purchases);
      assert.ok(deferred.consumptionId > marks.consumptions);
      assert.ok(deferred.priceId > marks.prices);
      assert.ok(deferred.listItemId > marks.listItems);

      // Todo filho incluído pelos limites capturados referencia um produto que
      // também pertence à mesma casa e cabe no watermark de produtos. O bundle
      // posterior fica integralmente para a próxima sessão.
      const dangling = await pool.query<{ count: string }>(
        `select count(*)::text as count
         from (
           select ph.product_id
           from purchase_history ph
           inner join products p on p.id = ph.product_id
           where ph.casa_id = $1 and ph.id <= $2
             and (p.casa_id <> $1 or p.id > $3)
           union all
           select ie.product_id
           from inventory_events ie
           inner join products p on p.id = ie.product_id
           where p.casa_id = $1 and ie.id <= $4 and p.id > $3
           union all
           select pr.product_id
           from price_history pr
           inner join products p on p.id = pr.product_id
           where p.casa_id = $1 and pr.id <= $5 and p.id > $3
           union all
           select sli.product_id
           from shopping_list_items sli
           inner join products p on p.id = sli.product_id
           where sli.casa_id = $1 and sli.shopping_list_id = $6
             and sli.id <= $7 and (p.casa_id <> $1 or p.id > $3)
         ) unexpected`,
        [
          casaId,
          marks.purchases,
          marks.products,
          marks.consumptions,
          marks.prices,
          marks.activeListId,
          marks.listItems,
        ]
      );
      assert.equal(Number(dangling.rows[0].count), 0);
    } finally {
      if (writer) {
        await writer.query("rollback").catch(() => undefined);
        writer.release();
      }
      if (capture) {
        await capture.query("rollback").catch(() => undefined);
        capture.release();
      }
      if (laterWriter) {
        await laterWriter.query("rollback").catch(() => undefined);
        laterWriter.release();
      }
      if (casaId !== null) {
        await pool.query(`delete from purchase_history where casa_id = $1`, [casaId]);
        await pool.query(`delete from shopping_list_items where casa_id = $1`, [casaId]);
        await pool.query(
          `delete from inventory_events
           where product_id in (select id from products where casa_id = $1)`,
          [casaId]
        );
        await pool.query(
          `delete from price_history
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
