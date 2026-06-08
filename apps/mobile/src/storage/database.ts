import { uuidv4 } from '@repona/core';
import * as SQLite from 'expo-sqlite';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('repona.db');
  }

  return databasePromise;
}

export async function initializeDatabase() {
  const database = await getDatabase();

  await database.execAsync(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      category TEXT NOT NULL,
      barcode TEXT,
      photo_uri TEXT,
      purchase_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'missing')),
      alert_threshold TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shopping_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shopping_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopping_list_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity TEXT NOT NULL DEFAULT '1 un',
      checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (shopping_list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS shopping_list_items_unique_product
      ON shopping_list_items(shopping_list_id, product_id);

    CREATE INDEX IF NOT EXISTS shopping_list_items_product_idx
      ON shopping_list_items(product_id);

    CREATE TABLE IF NOT EXISTS purchase_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity TEXT NOT NULL DEFAULT '1 un',
      purchased_at TEXT NOT NULL,
      source_list_id INTEGER,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (source_list_id) REFERENCES shopping_lists(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS purchase_history_product_idx
      ON purchase_history(product_id);

    CREATE INDEX IF NOT EXISTS purchase_history_source_list_idx
      ON purchase_history(source_list_id);

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE,
      quantity TEXT NOT NULL DEFAULT '0 un',
      status TEXT NOT NULL DEFAULT 'missing' CHECK (status IN ('in_stock', 'missing')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('consumed')),
      quantity TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS inventory_events_product_idx
      ON inventory_events(product_id, event_type);

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS price_history_product_idx
      ON price_history(product_id, recorded_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    UPDATE shopping_lists
      SET status = 'archived', updated_at = datetime('now')
      WHERE status = 'active'
        AND id NOT IN (
          SELECT id FROM shopping_lists
          WHERE status = 'active'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        );

    CREATE UNIQUE INDEX IF NOT EXISTS shopping_lists_active_unique
      ON shopping_lists(status)
      WHERE status = 'active';
  `);

  await runMigrations(database);

  return database;
}

// Migrations versionadas por PRAGMA user_version (auditoria #16). Cada passo é
// idempotente: instalações antigas (user_version 0) rodam todos os passos uma
// vez e avançam a versão; instalações novas, já criadas pelo schema acima,
// também passam por eles sem efeito colateral. Versões futuras entram só como
// novos passos no fim do array.
const MIGRATIONS: Array<(db: SQLite.SQLiteDatabase) => Promise<void>> = [
  // v1: colunas adicionadas depois do schema inicial + identidade de sync.
  async (db) => {
    const productColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(products)');

    if (!productColumns.some((column) => column.name === 'alert_threshold')) {
      await db.execAsync('ALTER TABLE products ADD COLUMN alert_threshold TEXT;');
    }

    if (!productColumns.some((column) => column.name === 'archived')) {
      await db.execAsync('ALTER TABLE products ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;');
    }

    if (!productColumns.some((column) => column.name === 'occasional')) {
      await db.execAsync('ALTER TABLE products ADD COLUMN occasional INTEGER NOT NULL DEFAULT 0;');
    }

    // Identidade estável do produto para o sync (auditoria #1). SQLite não gera
    // UUID, então backfillamos as linhas existentes em JS antes do índice único.
    if (!productColumns.some((column) => column.name === 'sync_id')) {
      await db.execAsync('ALTER TABLE products ADD COLUMN sync_id TEXT;');
    }
    const semSyncId = await db.getAllAsync<{ id: number }>('SELECT id FROM products WHERE sync_id IS NULL');
    for (const row of semSyncId) {
      await db.runAsync('UPDATE products SET sync_id = ? WHERE id = ?', uuidv4(), row.id);
    }
    await db.execAsync('CREATE UNIQUE INDEX IF NOT EXISTS products_sync_id_unique ON products(sync_id);');
  },

  // v2: limpeza única de compras fantasma criadas pelo sync (source_list_id NULL)
  // quando já existe a compra original (com lista de origem) do mesmo produto,
  // quantidade e instante (comparado ao segundo, pois ms/formato podem divergir).
  async (db) => {
    const dedupApplied = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'dedup_purchase_history_v1'",
    );
    if (dedupApplied) return;

    await db.runAsync(`
      DELETE FROM purchase_history
      WHERE source_list_id IS NULL
        AND EXISTS (
          SELECT 1 FROM purchase_history original
          WHERE original.source_list_id IS NOT NULL
            AND original.product_id = purchase_history.product_id
            AND original.quantity = purchase_history.quantity
            AND substr(original.purchased_at, 1, 19) = substr(purchase_history.purchased_at, 1, 19)
        )
    `);
    await db.runAsync(
      "INSERT INTO settings (key, value) VALUES ('dedup_purchase_history_v1', ?)",
      new Date().toISOString(),
    );
  },

  // v3: garante a unicidade case-insensitive de products.name em instalações
  // antigas (o COLLATE NOCASE UNIQUE inline só vale na tabela recém-criada).
  // Se já houver duplicata local, não força o índice — quebraria o init e a
  // criação local já valida o nome por SELECT; deixa para reconciliação futura.
  async (db) => {
    const dup = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) - COUNT(DISTINCT lower(name)) AS n FROM products',
    );
    if ((dup?.n ?? 0) === 0) {
      await db.execAsync(
        'CREATE UNIQUE INDEX IF NOT EXISTS products_name_nocase_unique ON products(name COLLATE NOCASE);',
      );
    }
  },

  // v4: tombstone de item da lista para o sync (auditoria #9). Finalizar/remover
  // marca deleted em vez de apagar, para a deleção propagar sem ressuscitar.
  async (db) => {
    const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(shopping_list_items)');
    if (!cols.some((c) => c.name === 'deleted')) {
      await db.execAsync('ALTER TABLE shopping_list_items ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;');
    }
  },
];

async function runMigrations(database: SQLite.SQLiteDatabase) {
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    await MIGRATIONS[version](database);
    // PRAGMA não aceita parâmetro vinculado; o valor é um índice controlado.
    await database.execAsync(`PRAGMA user_version = ${version + 1}`);
  }
}
