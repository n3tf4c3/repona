import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { productNameKey } from "@repona/core";
import {
  CONSUME_DOMAIN_OPERATION_SQL,
  FINALIZE_PURCHASE_OPERATION_SQL,
  READ_DOMAIN_OPERATION_SQL,
} from "./domainMutationSql";

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  "Postgres: consumo/finalização convergem sob retry e concorrência",
  { skip: !databaseUrl },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 6 });
    let casaId: number | null = null;
    try {
      const casa = await pool.query<{ id: number }>(
        `insert into casas (name, invite_code_enc)
         values ('Integração #22', $1) returning id`,
        [`test:${randomUUID()}`],
      );
      casaId = casa.rows[0].id;

      const productNames = ["Arroz integra\u00e7\u00e3o", "Feij\u00e3o integra\u00e7\u00e3o"];
      const products = await pool.query<{ id: number }>(
        `insert into products (casa_id, name, name_key, category, status)
         values ($1, $2, $3, 'Mercearia', 'active'),
                ($1, $4, $5, 'Mercearia', 'active')
         returning id`,
        [
          casaId,
          productNames[0],
          productNameKey(productNames[0]),
          productNames[1],
          productNameKey(productNames[1]),
        ],
      );
      const [productA, productB] = products.rows.map((row) => row.id);
      await pool.query(
        `insert into inventory_items (product_id, quantity, status)
         values ($1, '5 un', 'in_stock'), ($2, '5 un', 'in_stock')`,
        [productA, productB],
      );

      const consumeA = randomUUID();
      const consumeB = randomUUID();
      await Promise.all([
        pool.query(CONSUME_DOMAIN_OPERATION_SQL, [consumeA, casaId, productA]),
        pool.query(CONSUME_DOMAIN_OPERATION_SQL, [consumeB, casaId, productA]),
      ]);
      const afterTwo = await pool.query<{ quantity: string }>(
        `select quantity from inventory_items where product_id = $1`,
        [productA],
      );
      assert.equal(afterTwo.rows[0].quantity, "3 un");
      assert.equal(
        Number(
          (
            await pool.query<{ count: string }>(
              `select count(*) from inventory_events
               where product_id = $1 and event_type = 'consumed'`,
              [productA],
            )
          ).rows[0].count,
        ),
        2,
      );

      // Retry da mesma chave: statement não devolve novo completed, mas o recibo
      // permanece e nenhum efeito é repetido.
      const replay = await pool.query(CONSUME_DOMAIN_OPERATION_SQL, [consumeA, casaId, productA]);
      assert.equal(replay.rowCount, 0);
      const receipt = await pool.query(READ_DOMAIN_OPERATION_SQL, [consumeA]);
      assert.equal(receipt.rows[0].resultCount, 1);
      assert.equal(
        (
          await pool.query<{ quantity: string }>(
            `select quantity from inventory_items where product_id = $1`,
            [productA],
          )
        ).rows[0].quantity,
        "3 un",
      );

      // Duas requisições simultâneas com a MESMA chave causam um único delta.
      const sameOperation = randomUUID();
      const sameOperationResults = await Promise.allSettled([
        pool.query(CONSUME_DOMAIN_OPERATION_SQL, [sameOperation, casaId, productB]),
        pool.query(CONSUME_DOMAIN_OPERATION_SQL, [sameOperation, casaId, productB]),
      ]);
      const rejected = sameOperationResults.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      assert.ok(rejected.length <= 1);
      if (rejected[0]) assert.equal((rejected[0].reason as { code?: string }).code, "23505");
      assert.equal(
        (
          await pool.query<{ quantity: string }>(
            `select quantity from inventory_items where product_id = $1`,
            [productB],
          )
        ).rows[0].quantity,
        "4 un",
      );

      const list = await pool.query<{ id: number }>(
        `insert into shopping_lists (casa_id, name, status)
         values ($1, 'Lista integração', 'active') returning id`,
        [casaId],
      );
      const listId = list.rows[0].id;
      await pool.query(
        `insert into shopping_list_items
          (casa_id, shopping_list_id, product_id, quantity, checked, deleted)
         values ($1, $2, $3, '2 un', true, false)`,
        [casaId, listId, productA],
      );

      const finalizeOperation = randomUUID();
      await Promise.all([
        pool.query(FINALIZE_PURCHASE_OPERATION_SQL, [
          finalizeOperation,
          casaId,
          listId,
          "Lista integração",
        ]),
        pool.query(FINALIZE_PURCHASE_OPERATION_SQL, [
          finalizeOperation,
          casaId,
          listId,
          "Lista integração",
        ]),
      ]);
      assert.equal(
        Number(
          (
            await pool.query<{ count: string }>(
              `select count(*) from purchase_history
               where product_id = $1 and deleted = false`,
              [productA],
            )
          ).rows[0].count,
        ),
        1,
      );
      assert.equal(
        (
          await pool.query<{ quantity: string }>(
            `select quantity from inventory_items where product_id = $1`,
            [productA],
          )
        ).rows[0].quantity,
        "2 un",
      );
      assert.equal(
        Number(
          (
            await pool.query<{ count: string }>(
              `select count(*) from inventory_events
               where product_id = $1 and event_type = 'set'`,
              [productA],
            )
          ).rows[0].count,
        ),
        1,
      );

      // Quantidade inválida não produz efeito parcial e memoriza o mesmo erro.
      await pool.query(
        `insert into shopping_list_items
          (casa_id, shopping_list_id, product_id, quantity, checked, deleted)
         values ($1, $2, $3, '0 un', true, false)`,
        [casaId, listId, productB],
      );
      const invalidOperation = randomUUID();
      const invalid = await pool.query(FINALIZE_PURCHASE_OPERATION_SQL, [
        invalidOperation,
        casaId,
        listId,
        "Lista integração",
      ]);
      assert.equal(invalid.rows[0].resultCount, -1);
      const invalidItem = await pool.query<{ deleted: boolean }>(
        `select deleted from shopping_list_items
         where shopping_list_id = $1 and product_id = $2`,
        [listId, productB],
      );
      assert.equal(invalidItem.rows[0].deleted, false);
    } finally {
      if (casaId !== null) {
        await pool.query(`delete from purchase_history where casa_id = $1`, [casaId]);
        await pool.query(`delete from shopping_list_items where casa_id = $1`, [casaId]);
        await pool.query(
          `delete from inventory_events
           where product_id in (select id from products where casa_id = $1)`,
          [casaId],
        );
        await pool.query(
          `delete from inventory_items
           where product_id in (select id from products where casa_id = $1)`,
          [casaId],
        );
        await pool.query(`delete from product_sync_aliases where casa_id = $1`, [casaId]);
        await pool.query(`delete from products where casa_id = $1`, [casaId]);
        await pool.query(`delete from shopping_lists where casa_id = $1`, [casaId]);
        await pool.query(`delete from domain_operations where casa_id = $1`, [casaId]);
        await pool.query(`delete from casas where id = $1`, [casaId]);
      }
      await pool.end();
    }
  },
);
