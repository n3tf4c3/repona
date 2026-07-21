// Backfill idempotente para bancos existentes gerenciados por `db:push`.
//
// `drizzle-kit push` aplica o schema, mas nao executa os UPDATE/INSERT de dados
// presentes em drizzle/0002_*. Este script fecha essa diferenca sem imprimir
// registros de dominio: atribui identidade aos eventos legados e cria exatamente
// um baseline `set` por produto que ainda nao tenha um. (#2/#72/#73)
//
// Uso, depois de `npm run db:push -w web`:
//   npm run sync-v2:backfill -w web          # dry-run (somente contagens)
//   npm run sync-v2:backfill -w web -- --yes # aplica e reverifica
import { config } from "dotenv";
import pg from "pg";
import { parseDatabaseUrl } from "../env-schema.mjs";

config({ path: ".env.local" });
config({ path: ".env" });

const { Pool } = pg;
const pool = new Pool({ connectionString: parseDatabaseUrl(process.env.DATABASE_URL) });
const confirmado = process.argv.slice(2).includes("--yes");

async function contar(client) {
  const { rows } = await client.query(`
    SELECT
      (SELECT count(*)::int FROM purchase_history WHERE sync_id IS NULL) AS purchases,
      (SELECT count(*)::int FROM price_history WHERE sync_id IS NULL) AS prices,
      (SELECT count(*)::int FROM inventory_events WHERE sync_id IS NULL) AS inventory_events,
      (
        SELECT count(*)::int
        FROM inventory_items ii
        INNER JOIN products p ON p.id = ii.product_id
        WHERE NOT EXISTS (
          SELECT 1 FROM inventory_events ie
          WHERE ie.product_id = ii.product_id AND ie.event_type = 'set'
        )
      ) AS baselines
  `);
  return rows[0];
}

function total(contagem) {
  return (
    Number(contagem.purchases) +
    Number(contagem.prices) +
    Number(contagem.inventory_events) +
    Number(contagem.baselines)
  );
}

function imprimir(rotulo, contagem) {
  console.log(rotulo);
  console.log(`  compras sem sync_id: ${contagem.purchases}`);
  console.log(`  precos sem sync_id: ${contagem.prices}`);
  console.log(`  eventos de estoque sem sync_id: ${contagem.inventory_events}`);
  console.log(`  produtos sem baseline set: ${contagem.baselines}`);
}

let client;
try {
  const antes = await contar(pool);
  imprimir("Pendencias do backfill sync v2:", antes);

  if (total(antes) === 0) {
    console.log("\nNada a aplicar: o backfill ja esta completo.");
  } else if (!confirmado) {
    console.log("\nDry-run. Rode novamente com --yes depois de conferir o banco alvo.");
  } else {
    client = await pool.connect();
    await client.query("BEGIN");
    try {
      // Serializa duas execucoes administrativas concorrentes. O lock e obtido
      // em um statement separado para a proxima consulta enxergar um snapshot
      // novo depois que um eventual executor anterior fizer COMMIT.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('repona:sync-v2-backfill', 0))"
      );

      await client.query(
        "UPDATE purchase_history SET sync_id = gen_random_uuid() WHERE sync_id IS NULL"
      );
      await client.query(
        "UPDATE price_history SET sync_id = gen_random_uuid() WHERE sync_id IS NULL"
      );
      await client.query(
        "UPDATE inventory_events SET sync_id = gen_random_uuid() WHERE sync_id IS NULL"
      );
      await client.query(`
        INSERT INTO inventory_events
          (sync_id, product_id, event_type, quantity, occurred_at)
        SELECT
          p.sync_id,
          ii.product_id,
          'set',
          ii.quantity,
          GREATEST(
            ii.updated_at,
            COALESCE(MAX(ie.occurred_at) + interval '1 millisecond', ii.updated_at)
          )
        FROM inventory_items ii
        INNER JOIN products p ON p.id = ii.product_id
        LEFT JOIN inventory_events ie ON ie.product_id = ii.product_id
        WHERE NOT EXISTS (
          SELECT 1 FROM inventory_events existing
          WHERE existing.product_id = ii.product_id AND existing.event_type = 'set'
        )
        GROUP BY ii.product_id, p.sync_id, ii.quantity, ii.updated_at
        ON CONFLICT (sync_id) WHERE sync_id IS NOT NULL DO NOTHING
      `);

      const depois = await contar(client);
      if (total(depois) !== 0) {
        imprimir("Backfill incompleto; a transacao sera revertida:", depois);
        throw new Error("SYNC_V2_BACKFILL_INCOMPLETO");
      }
      await client.query("COMMIT");
      imprimir("Backfill concluido e reverificado:", depois);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} catch (error) {
  if (error && ["42P01", "42703"].includes(error.code)) {
    console.error(
      "Schema ainda nao esta pronto para o backfill. Execute `npm run db:push -w web` primeiro."
    );
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  client?.release();
  await pool.end();
}

