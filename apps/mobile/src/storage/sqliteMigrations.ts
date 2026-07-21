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

// v9/v12: chave Unicode canônica persistida. Colisões legadas são fundidas de
// forma determinística e a transação só confirma com o índice único instalado.
type CollisionProduct = {
  id: number;
  sync_id: string | null;
  name: string;
  name_key: string | null;
  category: string;
  brand: string | null;
  barcode: string | null;
  photo_uri: string | null;
  status: string;
  alert_threshold: string | null;
  archived: number;
  occasional: number;
  updated_at: string;
};

type CollisionInventory = {
  id: number;
  product_id: number;
  quantity: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type CollisionListItem = {
  id: number;
  shopping_list_id: number;
  product_id: number;
  quantity: string;
  checked: number;
  deleted: number;
  updated_at: string;
};

function sqlIntegerList(values: number[]): string {
  return values.map((value) => String(Math.trunc(value))).join(', ');
}

function compareUpdatedAtNewest(
  left: { updated_at: string },
  right: { updated_at: string },
): number {
  const leftMs = Date.parse(left.updated_at);
  const rightMs = Date.parse(right.updated_at);
  const leftValid = !Number.isNaN(leftMs);
  const rightValid = !Number.isNaN(rightMs);
  if (leftValid && rightValid && leftMs !== rightMs) return rightMs - leftMs;
  if (leftValid !== rightValid) return leftValid ? -1 : 1;
  if (!leftValid && left.updated_at !== right.updated_at) {
    return right.updated_at.localeCompare(left.updated_at);
  }
  return 0;
}

function newestRow<T extends { id: number; updated_at: string }>(rows: T[]): T {
  return [...rows].sort(
    (left, right) => compareUpdatedAtNewest(left, right) || left.id - right.id,
  )[0];
}

async function createProductSyncAliasesTable(db: MigrationAdapter): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS product_sync_aliases (
      old_sync_id TEXT PRIMARY KEY NOT NULL,
      canonical_product_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (canonical_product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS product_sync_aliases_canonical_idx
      ON product_sync_aliases(canonical_product_id);
  `);
}

async function mergeShoppingListItems(
  db: MigrationAdapter,
  productIds: number[],
  canonicalId: number,
): Promise<void> {
  const items = await db.all<CollisionListItem>(`
    SELECT id, shopping_list_id, product_id, quantity, checked, deleted, updated_at
    FROM shopping_list_items
    WHERE product_id IN (${sqlIntegerList(productIds)})
    ORDER BY shopping_list_id, id
  `);
  const byList = new Map<number, CollisionListItem[]>();
  for (const item of items) {
    const group = byList.get(item.shopping_list_id) ?? [];
    group.push(item);
    byList.set(item.shopping_list_id, group);
  }

  for (const group of byList.values()) {
    const keeper = [...group].sort((left, right) => left.id - right.id)[0];
    const winner = [...group].sort(
      (left, right) =>
        compareUpdatedAtNewest(left, right) ||
        right.deleted - left.deleted ||
        left.id - right.id,
    )[0];
    const discardedIds = group.filter((item) => item.id !== keeper.id).map((item) => item.id);
    if (discardedIds.length > 0) {
      await db.exec(
        `DELETE FROM shopping_list_items WHERE id IN (${sqlIntegerList(discardedIds)});`,
      );
    }
    await db.run(
      `UPDATE shopping_list_items
       SET product_id = ?, quantity = ?, checked = ?, deleted = ?, updated_at = ?
       WHERE id = ?`,
      canonicalId,
      winner.quantity,
      winner.checked,
      winner.deleted,
      winner.updated_at,
      keeper.id,
    );
  }
}

async function reconcileProductGroup(
  db: MigrationAdapter,
  products: CollisionProduct[],
  reconciledAt: string,
): Promise<void> {
  const canonical = [...products].sort((left, right) => left.id - right.id)[0];
  const metadataWinner = newestRow(products);
  const productIds = products.map((product) => product.id);
  const losingIds = productIds.filter((id) => id !== canonical.id);
  const losingProducts = products.filter((product) => product.id !== canonical.id);
  const idList = sqlIntegerList(productIds);
  const losingIdList = sqlIntegerList(losingIds);

  await mergeShoppingListItems(db, productIds, canonical.id);

  for (const table of ['purchase_history', 'inventory_events', 'price_history']) {
    await db.exec(
      `UPDATE ${table} SET product_id = ${canonical.id} WHERE product_id IN (${losingIdList});`,
    );
  }

  const inventoryRows = await db.all<CollisionInventory>(`
    SELECT id, product_id, quantity, status, created_at, updated_at
    FROM inventory_items
    WHERE product_id IN (${idList})
  `);
  const inventoryWinner = inventoryRows.length > 0 ? newestRow(inventoryRows) : null;
  await db.exec(`DELETE FROM inventory_items WHERE product_id IN (${idList});`);

  await db.exec(
    `UPDATE product_sync_aliases
     SET canonical_product_id = ${canonical.id}
     WHERE canonical_product_id IN (${losingIdList});`,
  );
  for (const losing of losingProducts) {
    if (!losing.sync_id) continue;
    await db.run(
      `INSERT INTO product_sync_aliases (old_sync_id, canonical_product_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(old_sync_id) DO UPDATE SET
         canonical_product_id = excluded.canonical_product_id`,
      losing.sync_id,
      canonical.id,
      reconciledAt,
    );
  }
  if (canonical.sync_id) {
    await db.run('DELETE FROM product_sync_aliases WHERE old_sync_id = ?', canonical.sync_id);
  }

  await db.exec(`DELETE FROM products WHERE id IN (${losingIdList});`);
  await db.run(
    `UPDATE products SET
       name = ?, name_key = ?, category = ?, brand = ?, barcode = ?, photo_uri = ?,
       status = ?, alert_threshold = ?, archived = ?, occasional = ?, updated_at = ?
     WHERE id = ?`,
    metadataWinner.name,
    productNameKey(metadataWinner.name),
    metadataWinner.category,
    metadataWinner.brand,
    metadataWinner.barcode,
    metadataWinner.photo_uri,
    metadataWinner.status,
    metadataWinner.alert_threshold,
    metadataWinner.archived,
    metadataWinner.occasional,
    metadataWinner.updated_at,
    canonical.id,
  );

  if (inventoryWinner) {
    await db.run(
      `INSERT INTO inventory_items
         (product_id, quantity, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      canonical.id,
      inventoryWinner.quantity,
      inventoryWinner.status,
      inventoryWinner.created_at,
      inventoryWinner.updated_at,
    );
    await db.run(
      'UPDATE products SET status = ? WHERE id = ?',
      inventoryWinner.status === 'missing' ? 'missing' : 'active',
      canonical.id,
    );
  }

  await db.run(
    `UPDATE products
     SET purchase_count = (
       SELECT COUNT(*) FROM purchase_history
       WHERE purchase_history.product_id = products.id AND purchase_history.deleted = 0
     )
     WHERE id = ?`,
    canonical.id,
  );
}

async function reconcileProductNameKeyCollisionsInsideTransaction(
  db: MigrationAdapter,
): Promise<number> {
  const columns = await db.all<{ name: string }>('PRAGMA table_info(products)');
  if (!columns.some((column) => column.name === 'name_key')) {
    await db.exec('ALTER TABLE products ADD COLUMN name_key TEXT;');
  }

  // Recalcular todas as chaves corrige valores legados obsoletos. O indice deve
  // sair antes para que duas linhas possam convergir e ser reconciliadas aqui.
  await db.exec('DROP INDEX IF EXISTS products_name_key_unique;');
  await createProductSyncAliasesTable(db);

  const products = await db.all<CollisionProduct>(`
    SELECT id, sync_id, name, name_key, category, brand, barcode, photo_uri,
           status, alert_threshold, archived, occasional, updated_at
    FROM products
    ORDER BY id
  `);
  const byNameKey = new Map<string, CollisionProduct[]>();
  for (const product of products) {
    const nameKey = productNameKey(product.name);
    if (product.name_key !== nameKey) {
      await db.run('UPDATE products SET name_key = ? WHERE id = ?', nameKey, product.id);
    }
    product.name_key = nameKey;
    const group = byNameKey.get(nameKey) ?? [];
    group.push(product);
    byNameKey.set(nameKey, group);
  }

  let reconciled = 0;
  const reconciledAt = new Date().toISOString();
  for (const group of byNameKey.values()) {
    if (group.length < 2) continue;
    await reconcileProductGroup(db, group, reconciledAt);
    reconciled += group.length - 1;
  }

  if (!(await ensureProductNameKeyUnique(db))) {
    throw new Error('PRODUCT_NAME_KEY_RECONCILIATION_FAILED');
  }
  return reconciled;
}

export async function migrateProductNameKey(db: MigrationAdapter): Promise<void> {
  await reconcileProductNameKeyCollisions(db);
}

export async function reconcileProductNameKeyCollisions(
  db: MigrationAdapter,
): Promise<number> {
  let reconciled = 0;
  await db.transaction(async () => {
    reconciled = await reconcileProductNameKeyCollisionsInsideTransaction(db);
  });
  return reconciled;
}

// Verificação fail-closed usada pela migration e pelo boot: NULL, duplicata ou
// índice homônimo não-único impedem o banco de seguir sem reparo. (#76/#77)
export async function ensureProductNameKeyUnique(db: MigrationAdapter): Promise<boolean> {
  const integrity = await db.first<{ missing: number; duplicates: number }>(`
    SELECT COUNT(*) - COUNT(name_key) AS missing,
           COUNT(name_key) - COUNT(DISTINCT name_key) AS duplicates
    FROM products
  `);
  if ((integrity?.missing ?? 0) !== 0 || (integrity?.duplicates ?? 0) !== 0) return false;
  await db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS products_name_key_unique ON products(name_key);',
  );
  const indexes = await db.all<{ name: string; unique: number }>('PRAGMA index_list(products)');
  return indexes.some(
    (index) => index.name === 'products_name_key_unique' && Number(index.unique) === 1,
  );
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
