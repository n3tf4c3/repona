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

  const productColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(products)');

  if (!productColumns.some((column) => column.name === 'alert_threshold')) {
    await database.execAsync('ALTER TABLE products ADD COLUMN alert_threshold TEXT;');
  }

  if (!productColumns.some((column) => column.name === 'archived')) {
    await database.execAsync('ALTER TABLE products ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;');
  }

  if (!productColumns.some((column) => column.name === 'occasional')) {
    await database.execAsync('ALTER TABLE products ADD COLUMN occasional INTEGER NOT NULL DEFAULT 0;');
  }

  return database;
}
