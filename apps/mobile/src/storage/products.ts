import { isEmptyQuantity, uuidv4, validateProductFields } from '@repona/core';
import { initializeDatabase } from './database';
import type { NewProductInput } from '../types';
import type { InventoryStatus } from './inventory';

export type ProductStatus = 'active' | 'missing';

export type ProductRecord = {
  id: number;
  syncId: string;
  name: string;
  category: string;
  barcode: string | null;
  photoUri: string | null;
  purchaseCount: number;
  status: ProductStatus;
  alertThreshold: string | null;
  inventoryQuantity: string;
  inventoryStatus: InventoryStatus;
  consumptionCount: number;
  lastConsumedAt: string | null;
  archived: boolean;
  occasional: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProductRow = {
  id: number;
  sync_id: string;
  name: string;
  category: string;
  barcode: string | null;
  photo_uri: string | null;
  purchase_count: number;
  status: ProductStatus;
  alert_threshold: string | null;
  inventory_quantity: string;
  inventory_status: InventoryStatus;
  consumption_count: number;
  last_consumed_at: string | null;
  archived: number;
  occasional: number;
  created_at: string;
  updated_at: string;
};

const PRODUCT_SELECT = `
    SELECT
      p.id,
      p.sync_id,
      p.name,
      p.category,
      p.barcode,
      p.photo_uri,
      p.purchase_count,
      p.status,
      p.alert_threshold,
      COALESCE(ii.quantity, '0 un') as inventory_quantity,
      COALESCE(ii.status, 'missing') as inventory_status,
      COALESCE(ie.consumption_count, 0) as consumption_count,
      ie.last_consumed_at,
      p.archived,
      p.occasional,
      p.created_at,
      p.updated_at
    FROM products p
    LEFT JOIN inventory_items ii ON ii.product_id = p.id
    LEFT JOIN (
      SELECT product_id, COUNT(*) as consumption_count, MAX(occurred_at) as last_consumed_at
      FROM inventory_events
      WHERE event_type = 'consumed'
      GROUP BY product_id
    ) ie ON ie.product_id = p.id`;

async function queryProducts(archived: 0 | 1): Promise<ProductRecord[]> {
  const database = await initializeDatabase();
  const rows = await database.getAllAsync<ProductRow>(
    // Ordem alfabética (NOCASE): determinística entre dispositivos. Antes era por
    // created_at desc, que é local e embaralhava após re-pull. (auditoria #6)
    `${PRODUCT_SELECT}
     WHERE p.archived = ?
     ORDER BY p.name COLLATE NOCASE ASC`,
    archived,
  );
  return rows.map(mapProductRow);
}

export async function listProducts(): Promise<ProductRecord[]> {
  return queryProducts(0);
}

export async function listArchivedProducts(): Promise<ProductRecord[]> {
  return queryProducts(1);
}

// Todos os produtos, inclusive arquivados — usado só pela sincronização, para
// que o estado "arquivado" também suba para a nuvem.
export async function listAllProductsForSync(): Promise<ProductRecord[]> {
  const database = await initializeDatabase();
  const rows = await database.getAllAsync<ProductRow>(
    `${PRODUCT_SELECT} ORDER BY p.created_at DESC, p.name ASC`,
  );
  return rows.map(mapProductRow);
}

export async function archiveProduct(productId: number) {
  const database = await initializeDatabase();
  await database.runAsync(
    'UPDATE products SET archived = 1, updated_at = ? WHERE id = ?',
    new Date().toISOString(),
    productId,
  );
}

export async function unarchiveProduct(productId: number) {
  const database = await initializeDatabase();
  await database.runAsync(
    'UPDATE products SET archived = 0, updated_at = ? WHERE id = ?',
    new Date().toISOString(),
    productId,
  );
}

// Produto (outro que não o editado) que já tem este código de barras. Usado no
// cadastro para avisar antes de criar uma duplicata via scanner. Código vazio
// nunca casa.
export async function findProductByBarcode(
  barcode: string,
  excludeId?: number,
): Promise<{ id: number; name: string; archived: boolean } | null> {
  const code = barcode.trim();
  if (!code) return null;
  const database = await initializeDatabase();
  const row = await database.getFirstAsync<{ id: number; name: string; archived: number }>(
    'SELECT id, name, archived FROM products WHERE barcode = ? AND id <> ? LIMIT 1',
    code,
    excludeId ?? -1,
  );
  return row ? { id: row.id, name: row.name, archived: row.archived === 1 } : null;
}

export async function createProduct(input: NewProductInput): Promise<ProductRecord> {
  const database = await initializeDatabase();
  const name = input.name.trim();
  const category = input.category.trim();

  if (!name) {
    throw new Error('PRODUCT_NAME_REQUIRED');
  }
  validateProductFields(input);

  const existing = await database.getFirstAsync<{ id: number }>(
    'SELECT id FROM products WHERE lower(name) = lower(?) LIMIT 1',
    name,
  );

  if (existing) {
    throw new Error('PRODUCT_ALREADY_EXISTS');
  }

  const barcode = input.barcode?.trim() || null;
  if (barcode && (await findProductByBarcode(barcode))) {
    throw new Error('PRODUCT_BARCODE_EXISTS');
  }

  const now = new Date().toISOString();
  let productId = 0;
  await database.withTransactionAsync(async () => {
    const result = await database.runAsync(
      `INSERT INTO products (sync_id, name, category, barcode, photo_uri, alert_threshold, occasional, purchase_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'missing', ?, ?)`,
      uuidv4(),
      name,
      category || 'Mercearia',
      barcode,
      input.photoUri ?? null,
      input.alertThreshold?.trim() || null,
      input.occasional ? 1 : 0,
      now,
      now,
    );
    productId = result.lastInsertRowId;

    await database.runAsync(
      `INSERT INTO inventory_items (product_id, quantity, status, created_at, updated_at)
       VALUES (?, '0 un', 'missing', ?, ?)`,
      productId,
      now,
      now,
    );
  });

  const created = await database.getFirstAsync<ProductRow>(
    `SELECT
       p.id,
       p.sync_id,
       p.name,
       p.category,
       p.barcode,
       p.photo_uri,
       p.purchase_count,
       p.status,
       p.alert_threshold,
       COALESCE(ii.quantity, '0 un') as inventory_quantity,
       COALESCE(ii.status, 'missing') as inventory_status,
       COALESCE(ie.consumption_count, 0) as consumption_count,
       ie.last_consumed_at,
       p.archived,
       p.occasional,
       p.created_at,
       p.updated_at
     FROM products p
     LEFT JOIN inventory_items ii ON ii.product_id = p.id
     LEFT JOIN (
       SELECT product_id, COUNT(*) as consumption_count, MAX(occurred_at) as last_consumed_at
       FROM inventory_events
       WHERE event_type = 'consumed'
       GROUP BY product_id
     ) ie ON ie.product_id = p.id
     WHERE p.id = ?`,
    productId,
  );

  if (!created) {
    throw new Error('PRODUCT_NOT_FOUND_AFTER_INSERT');
  }

  return mapProductRow(created);
}

export async function updateProduct(productId: number, input: NewProductInput): Promise<ProductRecord> {
  const database = await initializeDatabase();
  const name = input.name.trim();
  const category = input.category.trim();

  if (!name) {
    throw new Error('PRODUCT_NAME_REQUIRED');
  }
  validateProductFields(input);

  const existing = await database.getFirstAsync<{ id: number }>(
    'SELECT id FROM products WHERE lower(name) = lower(?) AND id <> ? LIMIT 1',
    name,
    productId,
  );

  if (existing) {
    throw new Error('PRODUCT_ALREADY_EXISTS');
  }

  const barcode = input.barcode?.trim() || null;
  if (barcode && (await findProductByBarcode(barcode, productId))) {
    throw new Error('PRODUCT_BARCODE_EXISTS');
  }

  const now = new Date().toISOString();

  await database.runAsync(
    `UPDATE products
     SET name = ?,
          category = ?,
          barcode = ?,
          photo_uri = ?,
          alert_threshold = ?,
          occasional = ?,
          updated_at = ?
      WHERE id = ?`,
    name,
    category || 'Mercearia',
    barcode,
    input.photoUri ?? null,
    input.alertThreshold?.trim() || null,
    input.occasional ? 1 : 0,
    now,
    productId,
  );

  const updated = await database.getFirstAsync<ProductRow>(
    `SELECT
       p.id,
       p.sync_id,
       p.name,
       p.category,
       p.barcode,
       p.photo_uri,
       p.purchase_count,
       p.status,
       p.alert_threshold,
       COALESCE(ii.quantity, '0 un') as inventory_quantity,
       COALESCE(ii.status, 'missing') as inventory_status,
       COALESCE(ie.consumption_count, 0) as consumption_count,
       ie.last_consumed_at,
       p.archived,
       p.occasional,
       p.created_at,
       p.updated_at
     FROM products p
     LEFT JOIN inventory_items ii ON ii.product_id = p.id
     LEFT JOIN (
       SELECT product_id, COUNT(*) as consumption_count, MAX(occurred_at) as last_consumed_at
       FROM inventory_events
       WHERE event_type = 'consumed'
       GROUP BY product_id
     ) ie ON ie.product_id = p.id
     WHERE p.id = ?`,
    productId,
  );

  if (!updated) {
    throw new Error('PRODUCT_NOT_FOUND');
  }

  return mapProductRow(updated);
}

export async function deleteProduct(productId: number) {
  const database = await initializeDatabase();
  const historyCount = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM purchase_history WHERE product_id = ?',
    productId,
  );

  if ((historyCount?.count ?? 0) > 0) {
    throw new Error('PRODUCT_HAS_HISTORY');
  }

  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM inventory_events WHERE product_id = ?', productId);
    await database.runAsync('DELETE FROM inventory_items WHERE product_id = ?', productId);
    await database.runAsync('DELETE FROM shopping_list_items WHERE product_id = ?', productId);
    await database.runAsync('DELETE FROM products WHERE id = ?', productId);
  });
}

function mapProductRow(row: ProductRow): ProductRecord {
  const isMissing = isEmptyQuantity(row.inventory_quantity);
  return {
    id: row.id,
    syncId: row.sync_id,
    name: row.name,
    category: row.category,
    barcode: row.barcode,
    photoUri: row.photo_uri,
    purchaseCount: row.purchase_count,
    status: isMissing ? 'missing' : row.status,
    alertThreshold: row.alert_threshold,
    inventoryQuantity: row.inventory_quantity,
    inventoryStatus: isMissing ? 'missing' : row.inventory_status,
    consumptionCount: row.consumption_count,
    lastConsumedAt: row.last_consumed_at,
    archived: row.archived === 1,
    occasional: row.occasional === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
