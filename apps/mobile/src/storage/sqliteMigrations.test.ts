import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { productNameKey } from '@repona/core';
import {
  ensureProductNameKeyUnique,
  migrateProductNameKey,
  migratePurchaseHistoryPageIndex,
  migratePurchaseHistoryUpdatedAt,
  migrateSyncEventIdentity,
  type MigrationAdapter,
} from './sqliteMigrations';

type SqlValue = string | number | null;
type Statement = {
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown;
  run(...params: SqlValue[]): unknown;
};
type NodeDatabase = {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): Statement;
};

// O CI usa Node 22, que fornece node:sqlite. createRequire evita acoplar o
// typecheck do mobile à versão de @types/node instalada pelo workspace web.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => NodeDatabase;
};

function nodeAdapter(database: NodeDatabase): MigrationAdapter {
  return {
    all: async <T>(sql: string) => database.prepare(sql).all() as T[],
    first: async <T>(sql: string) => (database.prepare(sql).get() as T | undefined) ?? null,
    exec: async (sql: string) => {
      database.exec(sql);
    },
    run: async (sql: string, ...params) => {
      database.prepare(sql).run(...params);
    },
    transaction: async (operation) => {
      database.exec('BEGIN');
      try {
        await operation();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const PRODUCT_SYNC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function createLegacyDatabase(): NodeDatabase {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE purchase_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deleted INTEGER NOT NULL DEFAULT 0,
      purchased_at TEXT NOT NULL,
      source_list_name TEXT
    );
    CREATE TABLE price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price_cents INTEGER NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE inventory_items (
      product_id INTEGER PRIMARY KEY,
      quantity TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE TABLE inventory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type = 'consumed'),
      quantity TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    INSERT INTO products (sync_id, name) VALUES ('${PRODUCT_SYNC_ID}', 'Café');
    INSERT INTO purchase_history (deleted, purchased_at, source_list_name)
      VALUES (1, '2026-07-20T09:00:00.000Z', 'Feira');
    INSERT INTO price_history (price_cents, recorded_at)
      VALUES (1299, '2026-07-20T09:00:00.000Z');
    INSERT INTO inventory_items (product_id, quantity, updated_at)
      VALUES (1, '4 un', '2026-07-20T10:00:00.000Z');
    INSERT INTO inventory_events (product_id, event_type, quantity, occurred_at)
      VALUES (1, 'consumed', '1 un', '2026-07-20T10:01:00.000Z');
  `);
  return database;
}

test('SQLite real migra fixture legado até v11 de forma idempotente', async (context) => {
  const database = createLegacyDatabase();
  context.after(() => database.close());

  const adapter = nodeAdapter(database);
  await migratePurchaseHistoryUpdatedAt(adapter);
  await migrateProductNameKey(adapter);
  await migrateSyncEventIdentity(adapter);
  await migratePurchaseHistoryPageIndex(adapter);
  // Repetição simula retry após restart/crash e não pode alterar o resultado.
  await migratePurchaseHistoryUpdatedAt(adapter);
  await migrateProductNameKey(adapter);
  await migrateSyncEventIdentity(adapter);
  await migratePurchaseHistoryPageIndex(adapter);

  const purchaseColumns = database.prepare('PRAGMA table_info(purchase_history)').all() as Array<{
    name: string;
  }>;
  assert.equal(purchaseColumns.some((column) => column.name === 'updated_at'), true);
  assert.equal(
    (database.prepare('SELECT updated_at FROM purchase_history').get() as { updated_at: unknown })
      .updated_at,
    null,
  );

  const product = database.prepare('SELECT name_key FROM products').get() as {
    name_key: string;
  };
  assert.equal(product.name_key, productNameKey('Café'));

  const indexes = database.prepare('PRAGMA index_list(products)').all() as Array<{
    name: string;
    unique: number;
  }>;
  assert.equal(
    indexes.some((index) => index.name === 'products_name_key_unique' && Number(index.unique) === 1),
    true,
  );
  assert.throws(
    () =>
      database
        .prepare('INSERT INTO products (sync_id, name, name_key) VALUES (?, ?, ?)')
        .run('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Café', productNameKey('Café')),
    /UNIQUE constraint failed/,
  );

  for (const table of ['purchase_history', 'price_history', 'inventory_events']) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    assert.equal(columns.some((column) => column.name === 'sync_id'), true, table);
  }

  const inventoryEvents = database
    .prepare(
      `SELECT sync_id, event_type, quantity, occurred_at
       FROM inventory_events ORDER BY occurred_at, id`,
    )
    .all() as Array<{
      sync_id: string | null;
      event_type: string;
      quantity: string;
      occurred_at: string;
    }>;
  assert.equal(inventoryEvents.length, 2, 'retry não cria um segundo baseline');
  assert.deepEqual({ ...inventoryEvents[0] }, {
    sync_id: null,
    event_type: 'consumed',
    quantity: '1 un',
    occurred_at: '2026-07-20T10:01:00.000Z',
  });
  assert.equal(inventoryEvents[1].sync_id, PRODUCT_SYNC_ID);
  assert.equal(inventoryEvents[1].event_type, 'set');
  assert.equal(inventoryEvents[1].quantity, '4 un');
  assert.equal(inventoryEvents[1].occurred_at, '2026-07-20T10:01:00.001Z');

  const inventoryIndexes = database.prepare('PRAGMA index_list(inventory_events)').all() as Array<{
    name: string;
    unique: number;
  }>;
  assert.equal(
    inventoryIndexes.some(
      (index) => index.name === 'inventory_events_sync_id_unique' && Number(index.unique) === 1,
    ),
    true,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO inventory_events
             (sync_id, product_id, event_type, quantity, occurred_at)
           VALUES (?, 1, 'set', '3 un', '2026-07-20T11:00:00.000Z')`,
        )
        .run(inventoryEvents[1].sync_id),
    /UNIQUE constraint failed/,
  );

  const pageIndexColumns = database
    .prepare('PRAGMA index_info(purchase_history_page_idx)')
    .all() as Array<{ name: string }>;
  assert.deepEqual(
    pageIndexColumns.map((column) => column.name),
    ['deleted', 'purchased_at', 'source_list_name', 'id'],
  );
});

test('dois devices geram a mesma identidade para o baseline v10', async (context) => {
  const databases = [createLegacyDatabase(), createLegacyDatabase()];
  context.after(() => databases.forEach((database) => database.close()));

  await Promise.all(
    databases.map((database) => migrateSyncEventIdentity(nodeAdapter(database))),
  );
  const baselineIds = databases.map(
    (database) =>
      (
        database
          .prepare("SELECT sync_id FROM inventory_events WHERE event_type = 'set'")
          .get() as { sync_id: string }
      ).sync_id,
  );

  assert.deepEqual(baselineIds, [PRODUCT_SYNC_ID, PRODUCT_SYNC_ID]);
});

test('indice name_key e instalado depois que colisao legada e reconciliada', async (context) => {
  const database = new DatabaseSync(':memory:');
  context.after(() => database.close());
  database.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_key TEXT
    );
    INSERT INTO products (name, name_key) VALUES
      ('Café', '${productNameKey('Café')}'),
      ('Cafe combinado', '${productNameKey('Café')}');
  `);
  const adapter = nodeAdapter(database);

  assert.equal(await ensureProductNameKeyUnique(adapter), false);
  assert.equal(
    (
      database
        .prepare("SELECT count(*) AS n FROM pragma_index_list('products') WHERE name = 'products_name_key_unique'")
        .get() as { n: number }
    ).n,
    0,
  );

  await adapter.run(
    'UPDATE products SET name = ?, name_key = ? WHERE id = 2',
    'Café reserva',
    productNameKey('Café reserva'),
  );
  assert.equal(await ensureProductNameKeyUnique(adapter), true);
  assert.equal(
    (
      database
        .prepare("SELECT count(*) AS n FROM pragma_index_list('products') WHERE name = 'products_name_key_unique'")
        .get() as { n: number }
    ).n,
    1,
  );
});
