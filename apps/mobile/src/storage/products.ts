import { isEmptyQuantity } from '@repona/core';
import { initializeDatabase } from './database';
import type { NewProductInput } from '../types';
import type { InventoryStatus } from './inventory';

export type ProductStatus = 'active' | 'missing';

export type ProductRecord = {
  id: number;
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
  createdAt: string;
  updatedAt: string;
};

type ProductRow = {
  id: number;
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
  created_at: string;
  updated_at: string;
};

type SeedProduct = {
  name: string;
  category: string;
  purchaseCount: number;
  status?: ProductStatus;
};

const seedProducts: SeedProduct[] = [
  { name: 'Leite integral', category: 'Laticínios', purchaseCount: 12 },
  { name: 'Maçã Fuji', category: 'Hortifrúti', purchaseCount: 9 },
  { name: 'Café torrado', category: 'Bebidas', purchaseCount: 7, status: 'missing' },
  { name: 'Ovos brancos', category: 'Hortifrúti', purchaseCount: 11 },
  { name: 'Cenoura', category: 'Hortifrúti', purchaseCount: 6 },
  { name: 'Biscoito', category: 'Mercearia', purchaseCount: 5 },
];

export async function seedInitialProducts() {
  const database = await initializeDatabase();
  const count = await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM products');

  if ((count?.count ?? 0) > 0) {
    return;
  }

  const now = new Date().toISOString();

  await database.withTransactionAsync(async () => {
    for (const product of seedProducts) {
      const productStatus = product.status ?? 'active';
      const result = await database.runAsync(
        `INSERT INTO products (name, category, purchase_count, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        product.name,
        product.category,
        product.purchaseCount,
        productStatus,
        now,
        now,
      );

      await database.runAsync(
        `INSERT INTO inventory_items (product_id, quantity, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        result.lastInsertRowId,
        productStatus === 'missing' ? '0 un' : '1 un',
        productStatus === 'missing' ? 'missing' : 'in_stock',
        now,
        now,
      );
    }
  });
}

export async function listProducts(): Promise<ProductRecord[]> {
  const database = await initializeDatabase();
  const rows = await database.getAllAsync<ProductRow>(`
    SELECT
      p.id,
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
    ORDER BY p.created_at DESC, p.name ASC
  `);

  return rows.map(mapProductRow);
}

export async function createProduct(input: NewProductInput): Promise<ProductRecord> {
  const database = await initializeDatabase();
  const name = input.name.trim();
  const category = input.category.trim();

  if (!name) {
    throw new Error('PRODUCT_NAME_REQUIRED');
  }

  const existing = await database.getFirstAsync<{ id: number }>(
    'SELECT id FROM products WHERE lower(name) = lower(?) LIMIT 1',
    name,
  );

  if (existing) {
    throw new Error('PRODUCT_ALREADY_EXISTS');
  }

  const now = new Date().toISOString();
  let productId = 0;
  await database.withTransactionAsync(async () => {
    const result = await database.runAsync(
      `INSERT INTO products (name, category, barcode, photo_uri, alert_threshold, purchase_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 'missing', ?, ?)`,
      name,
      category || 'Mercearia',
      input.barcode ?? null,
      input.photoUri ?? null,
      input.alertThreshold?.trim() || null,
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

  const existing = await database.getFirstAsync<{ id: number }>(
    'SELECT id FROM products WHERE lower(name) = lower(?) AND id <> ? LIMIT 1',
    name,
    productId,
  );

  if (existing) {
    throw new Error('PRODUCT_ALREADY_EXISTS');
  }

  const now = new Date().toISOString();

  await database.runAsync(
    `UPDATE products
     SET name = ?,
          category = ?,
          barcode = ?,
          photo_uri = ?,
          alert_threshold = ?,
          updated_at = ?
      WHERE id = ?`,
    name,
    category || 'Mercearia',
    input.barcode ?? null,
    input.photoUri ?? null,
    input.alertThreshold?.trim() || null,
    now,
    productId,
  );

  const updated = await database.getFirstAsync<ProductRow>(
    `SELECT
       p.id,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
