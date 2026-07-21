import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { productNameKey } from "@repona/core";

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  "Postgres persiste exatamente a chave do core para unicidade e lookup",
  { skip: databaseUrl ? false : "TEST_DATABASE_URL ausente" },
  async (context) => {
    const pool = new pg.Pool({ connectionString: databaseUrl });

    const marker = randomUUID();
    const casa = await pool.query<{ id: number }>(
      `INSERT INTO casas (name, invite_code_enc)
       VALUES ($1, $2)
       RETURNING id`,
      [`Audit Unicode ${marker}`, `audit-unicode-${marker}`],
    );
    const casaId = casa.rows[0].id;
    context.after(async () => {
      try {
        await pool.query("DELETE FROM products WHERE casa_id = $1", [casaId]);
        await pool.query("DELETE FROM casas WHERE id = $1", [casaId]);
      } finally {
        await pool.end();
      }
    });

    const latinI = "I";
    const dottedCapitalI = "\u0130";
    assert.notEqual(productNameKey(latinI), productNameKey(dottedCapitalI));
    await pool.query(
      `INSERT INTO products (casa_id, sync_id, name, name_key, category)
       VALUES ($1, $2, $3, $4, 'Mercearia'),
              ($1, $5, $6, $7, 'Mercearia')`,
      [
        casaId,
        randomUUID(),
        latinI,
        productNameKey(latinI),
        randomUUID(),
        dottedCapitalI,
        productNameKey(dottedCapitalI),
      ],
    );

    const decomposed = "Cafe\u0301";
    const composed = "Caf\u00e9";
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO products (casa_id, sync_id, name, name_key, category)
       VALUES ($1, $2, $3, $4, 'Mercearia')
       RETURNING id`,
      [casaId, randomUUID(), decomposed, productNameKey(decomposed)],
    );

    const found = await pool.query<{ id: number }>(
      `SELECT id FROM products
       WHERE casa_id = $1 AND name_key = $2`,
      [casaId, productNameKey(composed)],
    );
    assert.deepEqual(found.rows, [{ id: inserted.rows[0].id }]);

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO products (casa_id, sync_id, name, name_key, category)
           VALUES ($1, $2, $3, $4, 'Mercearia')`,
          [casaId, randomUUID(), composed, productNameKey(composed)],
        ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "23505",
    );
  },
);
