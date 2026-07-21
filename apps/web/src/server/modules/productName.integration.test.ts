import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  "Postgres usa a mesma chave NFC para lookup e unicidade de produto",
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

    const decomposed = "Cafe\u0301";
    const composed = "Café";
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO products (casa_id, sync_id, name, category)
       VALUES ($1, $2, $3, 'Mercearia')
       RETURNING id`,
      [casaId, randomUUID(), decomposed],
    );

    const found = await pool.query<{ id: number }>(
      `SELECT id FROM products
       WHERE casa_id = $1
         AND lower(normalize(btrim(name), NFC)) =
             lower(normalize(btrim($2::text), NFC))`,
      [casaId, composed],
    );
    assert.deepEqual(found.rows, [{ id: inserted.rows[0].id }]);

    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO products (casa_id, sync_id, name, category)
           VALUES ($1, $2, $3, 'Mercearia')`,
          [casaId, randomUUID(), composed],
        ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "23505",
    );
  },
);
