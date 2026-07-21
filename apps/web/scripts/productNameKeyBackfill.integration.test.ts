import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import { productNameKey } from "@repona/core";
import pg from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
const appRoot = resolve(__dirname, "..");
const tsxCli = resolve(appRoot, "../../node_modules/tsx/dist/cli.mjs");
const backfillCli = resolve(appRoot, "scripts/backfill-product-name-key.ts");

function identifier(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function scopedDatabaseUrl(baseUrl: string, schema: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function runBackfill(url: string, apply: boolean) {
  return spawnSync(process.execPath, [tsxCli, backfillCli, ...(apply ? ["--yes"] : [])], {
    cwd: appRoot,
    env: { ...process.env, DATABASE_URL: url },
    encoding: "utf8",
    timeout: 20_000,
  });
}

test(
  "CLI PostgreSQL: backfill e idempotente, preserva I/İ e nao vaza dados",
  { skip: databaseUrl ? false : "TEST_DATABASE_URL ausente", timeout: 40_000 },
  async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const schema = identifier("audit_product_key_ok");
    const sensitiveA = "Produto Sigiloso I";
    const sensitiveB = "Produto Sigiloso \u0130";
    try {
      await pool.query(`create schema "${schema}"`);
      await pool.query(`
        create table "${schema}".products (
          id bigint primary key,
          casa_id bigint not null,
          name text not null
        )
      `);
      await pool.query(
        `insert into "${schema}".products (id, casa_id, name)
         values (99123, 88776, $1), (99124, 88776, $2)`,
        [sensitiveA, sensitiveB],
      );

      const url = scopedDatabaseUrl(databaseUrl as string, schema);
      const dryRun = runBackfill(url, false);
      assert.equal(dryRun.status, 0, dryRun.stderr);
      assert.match(dryRun.stdout, /Produtos analisados: 2/);
      assert.match(dryRun.stdout, /Coluna name_key: ausente/);

      const firstApply = runBackfill(url, true);
      assert.equal(firstApply.status, 0, firstApply.stderr);
      assert.match(firstApply.stdout, /Backfill concluido e reverificado/);

      const rows = await pool.query<{ name: string; name_key: string }>(
        `select name, name_key from "${schema}".products order by id`,
      );
      assert.deepEqual(
        rows.rows,
        [sensitiveA, sensitiveB].map((name) => ({ name, name_key: productNameKey(name) })),
      );
      assert.notEqual(rows.rows[0].name_key, rows.rows[1].name_key);

      const secondApply = runBackfill(url, true);
      assert.equal(secondApply.status, 0, secondApply.stderr);
      assert.match(secondApply.stdout, /Nada a aplicar/);

      const output = [dryRun.stdout, dryRun.stderr, firstApply.stdout, firstApply.stderr].join("\n");
      assert.doesNotMatch(output, /Produto Sigiloso/i);
      assert.doesNotMatch(output, /99123|99124|88776/);
      assert.doesNotMatch(output, new RegExp(productNameKey(sensitiveA), "iu"));
    } finally {
      await pool.query(`drop schema if exists "${schema}" cascade`);
      await pool.end();
    }
  },
);

test(
  "CLI PostgreSQL: colisao NFC aborta sem alterar schema nem dados",
  { skip: databaseUrl ? false : "TEST_DATABASE_URL ausente", timeout: 30_000 },
  async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const schema = identifier("audit_product_key_collision");
    const composed = "Caf\u00e9 privado";
    const decomposed = "Cafe\u0301 privado";
    try {
      await pool.query(`create schema "${schema}"`);
      await pool.query(`
        create table "${schema}".products (
          id bigint primary key,
          casa_id bigint not null,
          name text not null
        )
      `);
      await pool.query(
        `insert into "${schema}".products (id, casa_id, name)
         values (77101, 66101, $1), (77102, 66101, $2)`,
        [composed, decomposed],
      );

      const result = runBackfill(scopedDatabaseUrl(databaseUrl as string, schema), true);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /Backfill bloqueado/);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /privado|77101|77102|66101/iu);

      const state = await pool.query<{ rows: string; has_name_key: boolean }>(`
        select
          (select count(*)::text from "${schema}".products) as rows,
          exists (
            select 1 from information_schema.columns
            where table_schema = '${schema}'
              and table_name = 'products'
              and column_name = 'name_key'
          ) as has_name_key
      `);
      assert.deepEqual(state.rows, [{ rows: "2", has_name_key: false }]);
    } finally {
      await pool.query(`drop schema if exists "${schema}" cascade`);
      await pool.end();
    }
  },
);
