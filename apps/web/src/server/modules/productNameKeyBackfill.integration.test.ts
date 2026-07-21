import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { productNameKey } from "@repona/core";
import { Pool } from "pg";
import {
  applyProductNameKeys,
  preflightProductNameKeys,
  ProductNameKeyCollisionError,
} from "../../../scripts/backfill-product-name-key";

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  "backfill Postgres troca indices legados, preserva I/İ e faz retry/rollback seguro",
  { skip: databaseUrl ? false : "TEST_DATABASE_URL ausente" },
  async () => {
    const admin = new Pool({ connectionString: databaseUrl });
    const schemaName = `audit_name_key_${randomUUID().replaceAll("-", "")}`;
    const schemaIdentifier = `"${schemaName}"`;
    let schemaCreated = false;
    let pool: Pool | null = null;

    try {
      await admin.query(`CREATE SCHEMA ${schemaIdentifier}`);
      schemaCreated = true;
      pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schemaName},public`,
      });
      await pool.query(`
        CREATE TABLE products (
          id serial PRIMARY KEY,
          casa_id integer NOT NULL,
          name text NOT NULL,
          category text NOT NULL
        )
      `);
      // Bancos externos podem estar no baseline lower ou no indice NFC de 0005.
      // O backfill precisa remover ambos antes de instalar a coluna persistida.
      await pool.query(`
        CREATE UNIQUE INDEX products_casa_name_lower_unique
        ON products (casa_id, lower(name))
      `);
      await pool.query(`
        CREATE UNIQUE INDEX products_casa_name_key_unique
        ON products (casa_id, lower(normalize(btrim(name), NFC)))
      `);

      const decomposed = "Cafe\u0301";
      const composed = "Caf\u00e9";
      const latinI = "I";
      const dottedCapitalI = "\u0130";
      assert.notEqual(productNameKey(latinI), productNameKey(dottedCapitalI));
      await pool.query(
        `INSERT INTO products (casa_id, name, category)
         VALUES (1, $1, 'Teste'), (1, $2, 'Teste'), (1, $3, 'Teste')`,
        [decomposed, latinI, "Sensitive-Audit-Name"]
      );

      const before = await preflightProductNameKeys(pool);
      assert.equal(before.totalRows, 3);
      assert.equal(before.rowsNeedingUpdate, 3);
      assert.equal(before.collisionGroups, 0);
      assert.equal(before.columnExists, false);
      assert.equal(before.indexReady, false);
      assert.equal(before.legacyIndexExists, true);

      const applied = await applyProductNameKeys(pool);
      assert.equal(applied.changed, true);
      assert.equal(applied.after.rowsNeedingUpdate, 0);
      assert.equal(applied.after.columnReady, true);
      assert.equal(applied.after.indexReady, true);
      assert.equal(applied.after.legacyIndexExists, false);

      const persisted = await pool.query<{ name: string; name_key: string }>(
        "SELECT name, name_key FROM products ORDER BY id"
      );
      assert.deepEqual(
        persisted.rows.map((row) => row.name_key),
        persisted.rows.map((row) => productNameKey(row.name))
      );

      // O indice persistido usa os bytes produzidos pelo core, portanto os dois
      // nomes que lower() do Postgres podia colapsar agora coexistem corretamente.
      await pool.query(
        `INSERT INTO products (casa_id, name, name_key, category)
         VALUES (1, $1, $2, 'Teste')`,
        [dottedCapitalI, productNameKey(dottedCapitalI)]
      );
      const iRows = await pool.query<{ name_key: string }>(
        `SELECT name_key FROM products
         WHERE casa_id = 1 AND name_key = ANY($1::text[])
         ORDER BY name_key`,
        [[productNameKey(latinI), productNameKey(dottedCapitalI)]]
      );
      assert.deepEqual(
        new Set(iRows.rows.map((row) => row.name_key)),
        new Set([productNameKey(latinI), productNameKey(dottedCapitalI)])
      );

      const nfcLookup = await pool.query<{ id: number }>(
        "SELECT id FROM products WHERE casa_id = 1 AND name_key = $1",
        [productNameKey(composed)]
      );
      assert.equal(nfcLookup.rowCount, 1);
      await assert.rejects(
        pool.query(
          `INSERT INTO products (casa_id, name, name_key, category)
           VALUES (1, $1, $2, 'Teste')`,
          [composed, productNameKey(composed)]
        ),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === "23505"
      );

      const retry = await applyProductNameKeys(pool);
      assert.equal(retry.changed, false);
      assert.deepEqual(retry.after, retry.before);

      // Simula corrupcao legada sem indice. A colisao NFC precisa abortar antes
      // de alterar a chave incorreta ou recriar qualquer indice (rollback seguro).
      await pool.query('DROP INDEX "products_casa_name_key_unique"');
      await pool.query(
        `INSERT INTO products (casa_id, name, name_key, category)
         VALUES (1, $1, '__deliberately_wrong__', 'Teste')`,
        [composed]
      );
      await assert.rejects(
        applyProductNameKeys(pool),
        (error: unknown) =>
          error instanceof ProductNameKeyCollisionError &&
          error.summary.collisionGroups === 1 &&
          error.summary.collidingRows === 2
      );
      const rollback = await pool.query<{
        wrong_key_rows: number;
        persisted_index_exists: boolean;
        legacy_index_exists: boolean;
      }>(`
        SELECT
          count(*) FILTER (WHERE name_key = '__deliberately_wrong__')::int AS wrong_key_rows,
          EXISTS (
            SELECT 1 FROM pg_index index_data
            INNER JOIN pg_class index_relation ON index_relation.oid = index_data.indexrelid
            WHERE index_data.indrelid = 'products'::regclass
              AND index_relation.relname = 'products_casa_name_key_unique'
          ) AS persisted_index_exists,
          EXISTS (
            SELECT 1 FROM pg_index index_data
            INNER JOIN pg_class index_relation ON index_relation.oid = index_data.indexrelid
            WHERE index_data.indrelid = 'products'::regclass
              AND index_relation.relname = 'products_casa_name_lower_unique'
          ) AS legacy_index_exists
        FROM products
      `);
      assert.deepEqual(rollback.rows, [
        {
          wrong_key_rows: 1,
          persisted_index_exists: false,
          legacy_index_exists: false,
        },
      ]);
    } finally {
      await pool?.end();
      if (schemaCreated) await admin.query(`DROP SCHEMA ${schemaIdentifier} CASCADE`);
      await admin.end();
    }
  }
);
