import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  "Postgres mantem uma unica politica para excluir a lista de origem",
  { skip: databaseUrl ? false : "TEST_DATABASE_URL ausente" },
  async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    let casaId: number | null = null;

    try {
      const marker = randomUUID();
      const casa = await pool.query<{ id: number }>(
        `insert into casas (name, invite_code_enc)
         values ($1, $2)
         returning id`,
        [`Audit FK ${marker}`, `audit-fk-${marker}`],
      );
      casaId = casa.rows[0].id;

      const product = await pool.query<{ id: number }>(
        `insert into products (casa_id, sync_id, name, category)
         values ($1, $2, $3, 'Mercearia')
         returning id`,
        [casaId, randomUUID(), `Produto FK ${marker}`],
      );
      const list = await pool.query<{ id: number }>(
        `insert into shopping_lists (casa_id, name, status)
         values ($1, $2, 'archived')
         returning id`,
        [casaId, `Lista FK ${marker}`],
      );
      const listId = list.rows[0].id;
      const sourceListName = `Lista FK ${marker}`;

      const purchase = await pool.query<{ id: number }>(
        `insert into purchase_history
           (sync_id, casa_id, product_id, quantity, source_list_id, source_list_name)
         values ($1, $2, $3, '1 un', $4, $5)
         returning id`,
        [randomUUID(), casaId, product.rows[0].id, listId, sourceListName],
      );

      // A politica unica e RESTRICT/NO ACTION: nao existe mais uma FK simples
      // tentando SET NULL ao mesmo tempo que a composta impede o delete.
      await assert.rejects(
        () => pool.query("delete from shopping_lists where id = $1", [listId]),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === "23503",
      );

      // Um futuro purge explicito preserva o historico ao soltar o vinculo e
      // excluir a lista dentro da mesma transacao.
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          "update purchase_history set source_list_id = null where source_list_id = $1",
          [listId],
        );
        await client.query("delete from shopping_lists where id = $1", [listId]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }

      const remaining = await pool.query<{
        source_list_id: number | null;
        source_list_name: string | null;
      }>(
        `select source_list_id, source_list_name
         from purchase_history
         where id = $1`,
        [purchase.rows[0].id],
      );
      assert.deepEqual(remaining.rows, [
        { source_list_id: null, source_list_name: sourceListName },
      ]);
    } finally {
      if (casaId !== null) {
        await pool.query("delete from purchase_history where casa_id = $1", [casaId]);
        await pool.query("delete from shopping_lists where casa_id = $1", [casaId]);
        await pool.query("delete from products where casa_id = $1", [casaId]);
        await pool.query("delete from casas where id = $1", [casaId]);
      }
      await pool.end();
    }
  },
);
