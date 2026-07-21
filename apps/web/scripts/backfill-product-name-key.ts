// Preflight/backfill idempotente da chave persistida de nomes de produto (#76).
//
// Uso ANTES de `db:push` em um banco existente:
//   npm run db:product-name-key -w web          # somente contagens
//   npm run db:product-name-key -w web -- --yes # aplica sob locks e reverifica
//
// O processo nunca imprime nomes, chaves, ids, tokens ou a URL do banco. Uma
// colisao e informada apenas por contagens e precisa ser reconciliada antes do
// rollout do schema.
import { config } from "dotenv";
import { resolve } from "node:path";
import pg, { type Pool, type PoolClient } from "pg";
import { parseDatabaseUrl } from "../env-schema.mjs";
import {
  analyzeProductNameKeys,
  formatProductNameKeyPreflight,
  toProductNameKeyPreflightSummary,
  type ProductNameKeyPreflightSummary,
  type ProductNameKeySourceRow,
} from "./productNameKeyBackfill";

type ColumnState = {
  exists: boolean;
  compatible: boolean;
  ready: boolean;
};

type StructureState = {
  column: ColumnState;
  indexReady: boolean;
  legacyIndexExists: boolean;
};

type DatabaseProductRow = {
  id: string;
  casa_id: string;
  name: string;
  name_key: string | null;
};

export type ProductNameKeyApplyResult = {
  before: ProductNameKeyPreflightSummary;
  after: ProductNameKeyPreflightSummary;
  changed: boolean;
};

export class ProductNameKeyCollisionError extends Error {
  constructor(readonly summary: ProductNameKeyPreflightSummary) {
    super("PRODUCT_NAME_KEY_COLLISION");
    this.name = "ProductNameKeyCollisionError";
  }
}

export class ProductNameKeySchemaError extends Error {
  constructor(code: "PRODUCT_NAME_KEY_COLUMN_INCOMPATIBLE" | "PRODUCT_NAME_KEY_VERIFY_FAILED") {
    super(code);
    this.name = "ProductNameKeySchemaError";
  }
}

async function readColumnState(client: PoolClient): Promise<ColumnState> {
  const result = await client.query<{
    attnotnull: boolean;
    data_type: string;
    attgenerated: string;
  }>(`
    SELECT
      attribute.attnotnull,
      format_type(attribute.atttypid, attribute.atttypmod) AS data_type,
      attribute.attgenerated
    FROM pg_attribute attribute
    WHERE attribute.attrelid = to_regclass('products')
      AND attribute.attname = 'name_key'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  `);
  const row = result.rows[0];
  if (!row) return { exists: false, compatible: true, ready: false };

  const compatible = row.data_type === "text" && row.attgenerated === "";
  return {
    exists: true,
    compatible,
    ready: compatible && row.attnotnull,
  };
}

async function readIndexReady(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ ready: boolean }>(`
    SELECT (
      index_data.indisunique
      AND index_data.indisvalid
      AND index_data.indisready
      AND index_data.indexprs IS NULL
      AND index_data.indpred IS NULL
      AND index_data.indnkeyatts = 2
      AND index_data.indnatts = 2
      AND index_data.indkey::text =
        casa_attribute.attnum::text || ' ' || name_key_attribute.attnum::text
    ) AS ready
    FROM pg_index index_data
    INNER JOIN pg_attribute casa_attribute
      ON casa_attribute.attrelid = index_data.indrelid
     AND casa_attribute.attname = 'casa_id'
     AND NOT casa_attribute.attisdropped
    INNER JOIN pg_attribute name_key_attribute
      ON name_key_attribute.attrelid = index_data.indrelid
     AND name_key_attribute.attname = 'name_key'
     AND NOT name_key_attribute.attisdropped
    WHERE index_data.indexrelid = to_regclass('products_casa_name_key_unique')
      AND index_data.indrelid = to_regclass('products')
  `);
  return result.rows[0]?.ready === true;
}

async function readLegacyIndexExists(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_index index_data
      WHERE index_data.indexrelid = to_regclass('products_casa_name_lower_unique')
        AND index_data.indrelid = to_regclass('products')
    ) AS exists
  `);
  return result.rows[0]?.exists === true;
}

async function readStructureState(client: PoolClient): Promise<StructureState> {
  const column = await readColumnState(client);
  return {
    column,
    indexReady: column.exists ? await readIndexReady(client) : false,
    legacyIndexExists: await readLegacyIndexExists(client),
  };
}

async function readProducts(
  client: PoolClient,
  columnExists: boolean
): Promise<ProductNameKeySourceRow[]> {
  const storedColumn = columnExists ? "name_key" : "NULL::text";
  const result = await client.query<DatabaseProductRow>(`
    SELECT
      id::text AS id,
      casa_id::text AS casa_id,
      name,
      ${storedColumn} AS name_key
    FROM products
    ORDER BY casa_id, id
  `);
  return result.rows.map((row) => ({
    id: row.id,
    casaId: row.casa_id,
    name: row.name,
    storedNameKey: row.name_key,
  }));
}

async function inspect(client: PoolClient): Promise<{
  summary: ProductNameKeyPreflightSummary;
  targetRows: ReturnType<typeof analyzeProductNameKeys>["targetRows"];
  structure: StructureState;
}> {
  const structure = await readStructureState(client);
  if (structure.column.exists && !structure.column.compatible) {
    throw new ProductNameKeySchemaError("PRODUCT_NAME_KEY_COLUMN_INCOMPATIBLE");
  }
  const analysis = analyzeProductNameKeys(await readProducts(client, structure.column.exists));
  return {
    summary: toProductNameKeyPreflightSummary(analysis, {
      columnExists: structure.column.exists,
      columnReady: structure.column.ready,
      indexReady: structure.indexReady,
      legacyIndexExists: structure.legacyIndexExists,
    }),
    targetRows: analysis.targetRows,
    structure,
  };
}

export async function preflightProductNameKeys(
  pool: Pool
): Promise<ProductNameKeyPreflightSummary> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await inspect(client);
    await client.query("COMMIT");
    return result.summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function applyProductNameKeys(pool: Pool): Promise<ProductNameKeyApplyResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // O advisory lock serializa dois operadores; o lock da tabela impede que
    // inserts/renames escapem entre a analise, o preenchimento e o novo indice.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('repona:product-name-key-backfill:v1', 0))"
    );
    await client.query("LOCK TABLE products IN ACCESS EXCLUSIVE MODE");

    const inspected = await inspect(client);
    if (inspected.summary.collisionGroups > 0) {
      throw new ProductNameKeyCollisionError(inspected.summary);
    }

    const alreadyReady =
      inspected.summary.rowsNeedingUpdate === 0 &&
      inspected.summary.columnReady &&
      inspected.summary.indexReady &&
      !inspected.summary.legacyIndexExists;
    if (alreadyReady) {
      await client.query("COMMIT");
      return { before: inspected.summary, after: inspected.summary, changed: false };
    }

    await client.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS name_key text");
    await client.query(`
      CREATE TEMPORARY TABLE repona_product_name_key_backfill (
        id bigint PRIMARY KEY,
        name_key text NOT NULL
      ) ON COMMIT DROP
    `);
    if (inspected.targetRows.length > 0) {
      await client.query(
        `INSERT INTO repona_product_name_key_backfill (id, name_key)
         SELECT * FROM unnest($1::bigint[], $2::text[])`,
        [
          inspected.targetRows.map((row) => row.id),
          inspected.targetRows.map((row) => row.nameKey),
        ]
      );
    }

    // Remove tanto o indice legado por expressao quanto uma versao persistida
    // incorreta. O ACCESS EXCLUSIVE mantem a unicidade logica durante a troca.
    await client.query(`
      DO $drop_product_name_indexes$
      DECLARE
        products_schema name;
      BEGIN
        SELECT namespace.nspname
        INTO products_schema
        FROM pg_class relation
        INNER JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE relation.oid = to_regclass('products');

        EXECUTE format(
          'DROP INDEX IF EXISTS %I.%I',
          products_schema,
          'products_casa_name_lower_unique'
        );
        EXECUTE format(
          'DROP INDEX IF EXISTS %I.%I',
          products_schema,
          'products_casa_name_key_unique'
        );
      END
      $drop_product_name_indexes$
    `);
    const updated = await client.query(`
      UPDATE products product
      SET name_key = source.name_key
      FROM repona_product_name_key_backfill source
      WHERE source.id = product.id
    `);
    if (updated.rowCount !== inspected.summary.totalRows) {
      throw new ProductNameKeySchemaError("PRODUCT_NAME_KEY_VERIFY_FAILED");
    }

    await client.query("ALTER TABLE products ALTER COLUMN name_key SET NOT NULL");
    await client.query(`
      CREATE UNIQUE INDEX products_casa_name_key_unique
      ON products USING btree (casa_id, name_key)
    `);

    const verified = await inspect(client);
    if (
      verified.summary.totalRows !== inspected.summary.totalRows ||
      verified.summary.rowsNeedingUpdate !== 0 ||
      verified.summary.collisionGroups !== 0 ||
      !verified.summary.columnReady ||
      !verified.summary.indexReady ||
      verified.summary.legacyIndexExists
    ) {
      throw new ProductNameKeySchemaError("PRODUCT_NAME_KEY_VERIFY_FAILED");
    }

    await client.query("COMMIT");
    return { before: inspected.summary, after: verified.summary, changed: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function safeErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/i.test(code) ? code : null;
}

async function main(): Promise<void> {
  const appRoot = resolve(__dirname, "..");
  config({ path: resolve(appRoot, ".env.local"), quiet: true });
  config({ path: resolve(appRoot, ".env"), quiet: true });
  const confirmed = process.argv.slice(2).includes("--yes");
  let pool: Pool | null = null;
  try {
    pool = new pg.Pool({ connectionString: parseDatabaseUrl(process.env.DATABASE_URL) });
    if (!confirmed) {
      const summary = await preflightProductNameKeys(pool);
      console.log(formatProductNameKeyPreflight(summary));
      if (summary.collisionGroups > 0) {
        console.error("Preflight bloqueado: reconcilie as colisoes antes do db:push.");
        process.exitCode = 2;
      } else if (
        summary.rowsNeedingUpdate === 0 &&
        summary.columnReady &&
        summary.indexReady &&
        !summary.legacyIndexExists
      ) {
        console.log("Nada a aplicar: coluna, valores e indice ja estao prontos.");
      } else {
        console.log("Dry-run. Rode novamente com --yes antes do db:push.");
      }
      return;
    }

    const result = await applyProductNameKeys(pool);
    console.log(formatProductNameKeyPreflight(result.after));
    console.log(
      result.changed
        ? "Backfill concluido e reverificado; o db:push pode ser executado."
        : "Nada a aplicar: coluna, valores e indice ja estao prontos."
    );
  } catch (error) {
    if (error instanceof ProductNameKeyCollisionError) {
      console.error(formatProductNameKeyPreflight(error.summary));
      console.error("Backfill bloqueado: reconcilie as colisoes antes do db:push.");
      process.exitCode = 2;
      return;
    }

    const code = safeErrorCode(error);
    if (code === "42P01") {
      console.error("Tabela products ausente; aplique primeiro o baseline existente do banco.");
    } else if (error instanceof ProductNameKeySchemaError) {
      console.error(`Backfill abortado de forma segura (${error.message}).`);
    } else {
      console.error(code ? `Backfill abortado de forma segura (${code}).` : "Backfill abortado de forma segura.");
    }
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

if (require.main === module) {
  void main().catch(() => {
    // Ultima barreira: nem mesmo uma falha ao encerrar o pool deve fazer o Node
    // despejar stack/URL de conexao no log operacional.
    console.error("Backfill abortado de forma segura.");
    process.exitCode = 1;
  });
}
