import { productNameKey } from '@repona/core';

type MigrationValue = string | number | null;

// Subconjunto mínimo comum entre expo-sqlite e node:sqlite. Mantê-lo puro
// permite executar as migrations contra um SQLite real no CI sem carregar Expo.
export type MigrationAdapter = {
  all<T>(sql: string): Promise<T[]>;
  first<T>(sql: string): Promise<T | null>;
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: MigrationValue[]): Promise<void>;
  transaction(operation: () => Promise<void>): Promise<void>;
};

// v8: carimbo da última edição do tombstone de compra, base do un-delete LWW.
export async function migratePurchaseHistoryUpdatedAt(db: MigrationAdapter): Promise<void> {
  const columns = await db.all<{ name: string }>('PRAGMA table_info(purchase_history)');
  if (!columns.some((column) => column.name === 'updated_at')) {
    await db.exec('ALTER TABLE purchase_history ADD COLUMN updated_at TEXT;');
  }
}

// v9: chave Unicode canônica persistida. O índice só pode ser criado quando o
// banco legado não contém colisões; nesses casos o CRUD ainda impede novas
// duplicatas e a reconciliação existente continua sendo uma etapa operacional.
export async function migrateProductNameKey(db: MigrationAdapter): Promise<void> {
  const columns = await db.all<{ name: string }>('PRAGMA table_info(products)');
  if (!columns.some((column) => column.name === 'name_key')) {
    await db.exec('ALTER TABLE products ADD COLUMN name_key TEXT;');
  }

  const withoutKey = await db.all<{ id: number; name: string }>(
    'SELECT id, name FROM products WHERE name_key IS NULL',
  );
  for (const row of withoutKey) {
    await db.run('UPDATE products SET name_key = ? WHERE id = ?', productNameKey(row.name), row.id);
  }

  const duplicate = await db.first<{ n: number }>(
    'SELECT COUNT(*) - COUNT(DISTINCT name_key) AS n FROM products WHERE name_key IS NOT NULL',
  );
  if ((duplicate?.n ?? 0) === 0) {
    await db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS products_name_key_unique ON products(name_key);',
    );
  }
}

// v10: adiciona identidade aos eventos e converte a tabela de estoque para o
// protocolo set+consumed. A presença de sync_id é também o marcador de commit:
// se o processo cair depois da transação e antes de avançar user_version, o
// retry não apaga UUIDs nem cria um segundo baseline.
export async function migrateSyncEventIdentity(db: MigrationAdapter): Promise<void> {
  await db.transaction(async () => {
    for (const table of ['purchase_history', 'price_history']) {
      const columns = await db.all<{ name: string }>(`PRAGMA table_info(${table})`);
      if (!columns.some((column) => column.name === 'sync_id')) {
        await db.exec(`ALTER TABLE ${table} ADD COLUMN sync_id TEXT;`);
      }
      await db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_sync_id_unique ON ${table}(sync_id) WHERE sync_id IS NOT NULL;`,
      );
    }

    const inventoryColumns = await db.all<{ name: string }>('PRAGMA table_info(inventory_events)');
    const alreadyMigrated = inventoryColumns.some((column) => column.name === 'sync_id');
    if (!alreadyMigrated) {
      await db.exec(`
        DROP TABLE IF EXISTS inventory_events_v10;
        CREATE TABLE inventory_events_v10 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sync_id TEXT,
          product_id INTEGER NOT NULL,
          event_type TEXT NOT NULL CHECK (event_type IN ('consumed', 'set')),
          quantity TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );
        INSERT INTO inventory_events_v10 (id, product_id, event_type, quantity, occurred_at)
          SELECT id, product_id, event_type, quantity, occurred_at FROM inventory_events;
        DROP TABLE inventory_events;
        ALTER TABLE inventory_events_v10 RENAME TO inventory_events;
      `);

      // O saldo materializado já incorpora os consumos legados. Um set posterior
      // ao último evento vira a base autoritativa sem descontá-los novamente. O
      // baseline reutiliza products.sync_id: todos os devices da casa geram a
      // mesma identidade e o merge não duplica o mesmo saldo inicial.
      const baselines = await db.all<{
        product_id: number;
        baseline_sync_id: string;
        quantity: string;
        updated_at: string;
        last_event_at: string | null;
      }>(`
        SELECT ii.product_id, p.sync_id AS baseline_sync_id, ii.quantity, ii.updated_at,
               MAX(ie.occurred_at) AS last_event_at
        FROM inventory_items ii
        INNER JOIN products p ON p.id = ii.product_id
        LEFT JOIN inventory_events ie ON ie.product_id = ii.product_id
        GROUP BY ii.product_id, p.sync_id, ii.quantity, ii.updated_at
      `);
      for (const row of baselines) {
        const inventoryMs = new Date(row.updated_at).getTime();
        const lastEventMs = row.last_event_at ? new Date(row.last_event_at).getTime() : Number.NaN;
        const baselineMs = Math.max(
          Number.isNaN(inventoryMs) ? 0 : inventoryMs,
          Number.isNaN(lastEventMs) ? 0 : lastEventMs + 1,
        );
        const occurredAt = baselineMs > 0
          ? new Date(baselineMs).toISOString()
          : new Date().toISOString();
        await db.run(
          `INSERT INTO inventory_events (sync_id, product_id, event_type, quantity, occurred_at)
           VALUES (?, ?, 'set', ?, ?)`,
          row.baseline_sync_id,
          row.product_id,
          row.quantity,
          occurredAt,
        );
      }
    }

    await db.exec(`
      CREATE INDEX IF NOT EXISTS inventory_events_product_idx
        ON inventory_events(product_id, event_type);
      CREATE UNIQUE INDEX IF NOT EXISTS inventory_events_sync_id_unique
        ON inventory_events(sync_id) WHERE sync_id IS NOT NULL;
    `);
  });
}

// v11: índice que sustenta o keyset do histórico mobile.
export async function migratePurchaseHistoryPageIndex(db: MigrationAdapter): Promise<void> {
  await db.exec(`
    CREATE INDEX IF NOT EXISTS purchase_history_page_idx
      ON purchase_history(deleted, purchased_at DESC, source_list_name ASC, id ASC);
  `);
}
