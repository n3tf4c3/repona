import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { productNameKey } from '@repona/core';
import {
  assertIncomingProductIdentitiesUnambiguous,
  promoteRemoteProductSyncId,
  type ProductIdentityDatabase,
} from './productSyncAliases';
import {
  ensureProductNameKeyUnique,
  migrateProductNameKey,
  migratePurchaseHistoryPageIndex,
  migratePurchaseHistoryUpdatedAt,
  migrateSyncEventIdentity,
  reconcileProductNameKeyCollisions,
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

function productIdentityAdapter(database: NodeDatabase): ProductIdentityDatabase {
  return {
    getAllAsync: async <T>(sql: string, ...params: SqlValue[]) =>
      database.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: SqlValue[]) => {
      database.prepare(sql).run(...params);
    },
  };
}

const PRODUCT_SYNC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function createLegacyDatabase(): NodeDatabase {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      category TEXT NOT NULL DEFAULT 'Mercearia',
      brand TEXT,
      barcode TEXT,
      photo_uri TEXT,
      purchase_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      alert_threshold TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      occasional INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '2026-07-20T08:00:00.000Z',
      updated_at TEXT NOT NULL DEFAULT '2026-07-20T08:00:00.000Z'
    );
    CREATE TABLE shopping_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE shopping_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopping_list_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity TEXT NOT NULL,
      checked INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (shopping_list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX shopping_list_items_unique_product
      ON shopping_list_items(shopping_list_id, product_id);
    CREATE TABLE purchase_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      purchased_at TEXT NOT NULL,
      source_list_id INTEGER,
      source_list_name TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (source_list_id) REFERENCES shopping_lists(id) ON DELETE SET NULL
    );
    CREATE TABLE price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE TABLE inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE,
      quantity TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
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
    INSERT INTO purchase_history
      (product_id, quantity, deleted, purchased_at, source_list_name)
      VALUES (1, '1 un', 1, '2026-07-20T09:00:00.000Z', 'Feira');
    INSERT INTO price_history (product_id, price_cents, recorded_at)
      VALUES (1, 1299, '2026-07-20T09:00:00.000Z');
    INSERT INTO inventory_items (product_id, quantity, status, created_at, updated_at)
      VALUES (1, '4 un', 'in_stock', '2026-07-20T08:00:00.000Z', '2026-07-20T10:00:00.000Z');
    INSERT INTO inventory_events (product_id, event_type, quantity, occurred_at)
      VALUES (1, 'consumed', '1 un', '2026-07-20T10:01:00.000Z');
  `);
  return database;
}

const COLLISION_SYNC_IDS = {
  canonical: '11111111-1111-4111-8111-111111111111',
  second: '22222222-2222-4222-8222-222222222222',
  third: '33333333-3333-4333-8333-333333333333',
};

function createV11CollisionDatabase(withExistingAliases = true): NodeDatabase {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA user_version = 11;
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT UNIQUE,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name_key TEXT,
      category TEXT NOT NULL,
      brand TEXT,
      barcode TEXT,
      photo_uri TEXT,
      purchase_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      alert_threshold TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      occasional INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE shopping_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE shopping_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopping_list_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity TEXT NOT NULL,
      checked INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (shopping_list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX shopping_list_items_unique_product
      ON shopping_list_items(shopping_list_id, product_id);
    CREATE TABLE purchase_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT,
      product_id INTEGER NOT NULL,
      quantity TEXT NOT NULL,
      purchased_at TEXT NOT NULL,
      source_list_id INTEGER,
      source_list_name TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (source_list_id) REFERENCES shopping_lists(id) ON DELETE SET NULL
    );
    CREATE TABLE inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL UNIQUE,
      quantity TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE TABLE inventory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT,
      product_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      quantity TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE TABLE price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_id TEXT,
      product_id INTEGER NOT NULL,
      price_cents INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);

  const insertProduct = database.prepare(`
    INSERT INTO products
      (sync_id, name, name_key, category, brand, barcode, photo_uri, purchase_count,
       status, alert_threshold, archived, occasional, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertProduct.run(
    COLLISION_SYNC_IDS.canonical,
    ' Café ',
    'stale-canonical',
    'Antiga',
    'Marca antiga',
    '111',
    'old.jpg',
    99,
    'missing',
    '1 un',
    0,
    0,
    '2026-07-20T08:00:00.000Z',
    '2026-07-20T10:00:00.000Z',
  );
  insertProduct.run(
    COLLISION_SYNC_IDS.second,
    'Cafe\u0301',
    productNameKey('Café'),
    'Nova',
    'Marca nova',
    '222',
    'new.jpg',
    7,
    'missing',
    '2 un',
    1,
    1,
    '2026-07-20T08:01:00.000Z',
    '2026-07-20T12:00:00.000Z',
  );
  insertProduct.run(
    COLLISION_SYNC_IDS.third,
    'CAFÉ',
    null,
    'Empate perde',
    'Marca empate',
    '333',
    'tie.jpg',
    3,
    'active',
    '3 un',
    0,
    0,
    '2026-07-20T08:02:00.000Z',
    '2026-07-20T12:00:00.000Z',
  );

  database.exec(`
    INSERT INTO shopping_lists (name, status, created_at, updated_at) VALUES
      ('Feira', 'active', '2026-07-20T08:00:00.000Z', '2026-07-20T08:00:00.000Z'),
      ('Mensal', 'archived', '2026-07-20T08:00:00.000Z', '2026-07-20T08:00:00.000Z');
    INSERT INTO shopping_list_items
      (shopping_list_id, product_id, quantity, checked, deleted, created_at, updated_at) VALUES
      (1, 1, '1 un', 0, 0, '2026-07-20T09:00:00.000Z', '2026-07-20T10:00:00.000Z'),
      (1, 2, '2 un', 0, 0, '2026-07-20T09:01:00.000Z', '2026-07-20T12:00:00.000Z'),
      (1, 3, '3 un', 1, 1, '2026-07-20T09:02:00.000Z', '2026-07-20T12:00:00.000Z'),
      (2, 2, '4 un', 1, 0, '2026-07-20T09:03:00.000Z', '2026-07-20T11:00:00.000Z');
    INSERT INTO purchase_history
      (sync_id, product_id, quantity, purchased_at, deleted, updated_at) VALUES
      ('purchase-1', 1, '1 un', '2026-07-20T09:00:00.000Z', 0, NULL),
      ('purchase-2', 2, '2 un', '2026-07-20T09:01:00.000Z', 0, NULL),
      ('purchase-3', 3, '3 un', '2026-07-20T09:02:00.000Z', 1, '2026-07-20T13:00:00.000Z');
    INSERT INTO inventory_items (product_id, quantity, status, created_at, updated_at) VALUES
      (1, '1 un', 'missing', '2026-07-20T08:00:00.000Z', '2026-07-20T10:00:00.000Z'),
      (2, '9 un', 'in_stock', '2026-07-20T08:01:00.000Z', '2026-07-20T13:00:00.000Z'),
      (3, '3 un', 'missing', '2026-07-20T08:02:00.000Z', '2026-07-20T11:00:00.000Z');
    INSERT INTO inventory_events
      (sync_id, product_id, event_type, quantity, occurred_at) VALUES
      ('inventory-1', 1, 'set', '1 un', '2026-07-20T10:00:00.000Z'),
      ('inventory-2', 2, 'consumed', '1 un', '2026-07-20T11:00:00.000Z'),
      ('inventory-3', 3, 'set', '3 un', '2026-07-20T12:00:00.000Z');
    INSERT INTO price_history (sync_id, product_id, price_cents, recorded_at) VALUES
      ('price-1', 1, 100, '2026-07-20T10:00:00.000Z'),
      ('price-2', 2, 200, '2026-07-20T11:00:00.000Z'),
      ('price-3', 3, 300, '2026-07-20T12:00:00.000Z');
  `);

  if (withExistingAliases) {
    database.exec(`
      CREATE TABLE product_sync_aliases (
        old_sync_id TEXT PRIMARY KEY NOT NULL,
        canonical_product_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (canonical_product_id) REFERENCES products(id) ON DELETE CASCADE
      );
      INSERT INTO product_sync_aliases (old_sync_id, canonical_product_id, created_at) VALUES
        ('preexisting-old', 3, '2026-07-20T07:00:00.000Z'),
        ('${COLLISION_SYNC_IDS.canonical}', 2, '2026-07-20T07:00:00.000Z');
    `);
  }

  return database;
}

function collisionState(database: NodeDatabase): Record<string, unknown[]> {
  const tables = [
    'products',
    'shopping_list_items',
    'purchase_history',
    'inventory_items',
    'inventory_events',
    'price_history',
  ];
  return Object.fromEntries(
    tables.map((table) => [
      table,
      (database.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Array<Record<string, unknown>>)
        .map((row) => ({ ...row })),
    ]),
  );
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

test('v12 reconcilia colisao legada e reaponta todas as referencias sem perda', async (context) => {
  const database = createV11CollisionDatabase();
  context.after(() => database.close());
  const adapter = nodeAdapter(database);

  const versionBefore = database.prepare('PRAGMA user_version').get() as { user_version: number };
  assert.equal(versionBefore.user_version, 11);
  assert.equal(await reconcileProductNameKeyCollisions(adapter), 2);
  database.exec('PRAGMA user_version = 12');

  const product = database.prepare(`
    SELECT id, sync_id, name, name_key, category, brand, barcode, photo_uri,
           purchase_count, status, alert_threshold, archived, occasional, updated_at
    FROM products
  `).get() as Record<string, unknown>;
  assert.deepEqual({ ...product }, {
    id: 1,
    sync_id: COLLISION_SYNC_IDS.canonical,
    name: 'Cafe\u0301',
    name_key: productNameKey('Café'),
    category: 'Nova',
    brand: 'Marca nova',
    barcode: '222',
    photo_uri: 'new.jpg',
    purchase_count: 2,
    status: 'active',
    alert_threshold: '2 un',
    archived: 1,
    occasional: 1,
    updated_at: '2026-07-20T12:00:00.000Z',
  });

  for (const table of ['purchase_history', 'inventory_events', 'price_history']) {
    const references = database
      .prepare(`SELECT product_id FROM ${table} ORDER BY id`)
      .all() as Array<{ product_id: number }>;
    assert.deepEqual(references.map((row) => row.product_id), [1, 1, 1], table);
  }

  const inventory = database.prepare(`
    SELECT product_id, quantity, status, created_at, updated_at FROM inventory_items
  `).get() as Record<string, unknown>;
  assert.deepEqual({ ...inventory }, {
    product_id: 1,
    quantity: '9 un',
    status: 'in_stock',
    created_at: '2026-07-20T08:01:00.000Z',
    updated_at: '2026-07-20T13:00:00.000Z',
  });

  const listItems = database.prepare(`
    SELECT id, shopping_list_id, product_id, quantity, checked, deleted, updated_at
    FROM shopping_list_items ORDER BY shopping_list_id, id
  `).all() as Array<Record<string, unknown>>;
  assert.deepEqual(listItems.map((row) => ({ ...row })), [
    {
      id: 1,
      shopping_list_id: 1,
      product_id: 1,
      quantity: '3 un',
      checked: 1,
      deleted: 1,
      updated_at: '2026-07-20T12:00:00.000Z',
    },
    {
      id: 4,
      shopping_list_id: 2,
      product_id: 1,
      quantity: '4 un',
      checked: 1,
      deleted: 0,
      updated_at: '2026-07-20T11:00:00.000Z',
    },
  ]);

  const aliases = database.prepare(`
    SELECT old_sync_id, canonical_product_id
    FROM product_sync_aliases ORDER BY old_sync_id
  `).all() as Array<Record<string, unknown>>;
  assert.deepEqual(aliases.map((row) => ({ ...row })), [
    { old_sync_id: COLLISION_SYNC_IDS.second, canonical_product_id: 1 },
    { old_sync_id: COLLISION_SYNC_IDS.third, canonical_product_id: 1 },
    { old_sync_id: 'preexisting-old', canonical_product_id: 1 },
  ]);

  const indexRows = database.prepare('PRAGMA index_list(products)').all() as Array<{
    name: string;
    unique: number;
  }>;
  assert.equal(
    indexRows.some(
      (index) => index.name === 'products_name_key_unique' && Number(index.unique) === 1,
    ),
    true,
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO products
        (sync_id, name, name_key, category, created_at, updated_at)
      VALUES (?, ?, ?, 'Teste', ?, ?)
    `).run(
      '44444444-4444-4444-8444-444444444444',
      'café',
      productNameKey('café'),
      '2026-07-20T14:00:00.000Z',
      '2026-07-20T14:00:00.000Z',
    ),
    /UNIQUE constraint failed/,
  );
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);

  const beforeRetry = {
    ...collisionState(database),
    aliases: aliases.map((row) => ({ ...row })),
  };
  assert.equal(await reconcileProductNameKeyCollisions(adapter), 0);
  const aliasesAfterRetry = database.prepare(`
    SELECT old_sync_id, canonical_product_id
    FROM product_sync_aliases ORDER BY old_sync_id
  `).all() as Array<Record<string, unknown>>;
  assert.deepEqual(
    {
      ...collisionState(database),
      aliases: aliasesAfterRetry.map((row) => ({ ...row })),
    },
    beforeRetry,
  );
});

test('v12 reverte integralmente se a reconciliacao falhar no meio', async (context) => {
  const database = createV11CollisionDatabase(false);
  context.after(() => database.close());
  const before = collisionState(database);
  const base = nodeAdapter(database);
  const failingAdapter: MigrationAdapter = {
    ...base,
    exec: async (sql) => {
      if (sql.includes('DELETE FROM products WHERE id IN')) {
        throw new Error('INJECTED_RECONCILIATION_FAILURE');
      }
      await base.exec(sql);
    },
  };

  await assert.rejects(
    () => reconcileProductNameKeyCollisions(failingAdapter),
    /INJECTED_RECONCILIATION_FAILURE/,
  );
  assert.deepEqual(collisionState(database), before);
  assert.equal(
    (
      database.prepare(`
        SELECT COUNT(*) AS n FROM sqlite_master
        WHERE type = 'table' AND name = 'product_sync_aliases'
      `).get() as { n: number }
    ).n,
    0,
  );
  assert.equal(
    (
      database.prepare(`
        SELECT COUNT(*) AS n FROM sqlite_master
        WHERE type = 'index' AND name = 'products_name_key_unique'
      `).get() as { n: number }
    ).n,
    0,
  );
  assert.equal(
    (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    11,
  );
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
});

test('sync promove alias local quando o servidor escolheu outro UUID canonico', async (context) => {
  const database = createV11CollisionDatabase();
  context.after(() => database.close());
  await reconcileProductNameKeyCollisions(nodeAdapter(database));
  const adapter = productIdentityAdapter(database);

  await assert.rejects(
    () => assertIncomingProductIdentitiesUnambiguous(adapter, [
      { syncId: COLLISION_SYNC_IDS.canonical, name: 'Café local' },
      { syncId: COLLISION_SYNC_IDS.second, name: 'Café servidor' },
    ]),
    /SYNC_PRODUCT_IDENTITY_CONFLICT/,
  );
  await assertIncomingProductIdentitiesUnambiguous(adapter, [
    { syncId: COLLISION_SYNC_IDS.second, name: 'Café servidor' },
  ]);

  const product = database.prepare('SELECT id, sync_id FROM products').get() as {
    id: number;
    sync_id: string;
  };
  await promoteRemoteProductSyncId(
    adapter,
    product,
    COLLISION_SYNC_IDS.second,
    '2026-07-20T15:00:00.000Z',
  );
  assert.equal(
    (database.prepare('SELECT sync_id FROM products WHERE id = 1').get() as { sync_id: string })
      .sync_id,
    COLLISION_SYNC_IDS.second,
  );
  const aliases = database.prepare(`
    SELECT old_sync_id, canonical_product_id
    FROM product_sync_aliases ORDER BY old_sync_id
  `).all() as Array<Record<string, unknown>>;
  assert.deepEqual(aliases.map((row) => ({ ...row })), [
    { old_sync_id: COLLISION_SYNC_IDS.canonical, canonical_product_id: 1 },
    { old_sync_id: COLLISION_SYNC_IDS.third, canonical_product_id: 1 },
    { old_sync_id: 'preexisting-old', canonical_product_id: 1 },
  ]);

  const beforeRetry = JSON.stringify(aliases.map((row) => ({ ...row })));
  await promoteRemoteProductSyncId(
    adapter,
    product,
    COLLISION_SYNC_IDS.second,
    '2026-07-20T16:00:00.000Z',
  );
  assert.equal(
    JSON.stringify(
      database.prepare(`
        SELECT old_sync_id, canonical_product_id
        FROM product_sync_aliases ORDER BY old_sync_id
      `).all(),
    ),
    beforeRetry,
  );
});
