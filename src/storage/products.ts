import { initializeDatabase } from './database';
import { NewProductInput } from '../types';

export type ProductStatus = 'active' | 'missing';

export type ProductRecord = {
  id: number;
  name: string;
  category: string;
  barcode: string | null;
  photoUri: string | null;
  purchaseCount: number;
  status: ProductStatus;
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
      await database.runAsync(
        `INSERT INTO products (name, category, purchase_count, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        product.name,
        product.category,
        product.purchaseCount,
        product.status ?? 'active',
        now,
        now,
      );
    }
  });
}

export async function listProducts(): Promise<ProductRecord[]> {
  const database = await initializeDatabase();
  const rows = await database.getAllAsync<ProductRow>(`
    SELECT id, name, category, barcode, photo_uri, purchase_count, status, created_at, updated_at
    FROM products
    ORDER BY created_at DESC, name ASC
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
  const result = await database.runAsync(
    `INSERT INTO products (name, category, barcode, photo_uri, purchase_count, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 'active', ?, ?)`,
    name,
    category || 'Mercearia',
    input.barcode ?? null,
    input.photoUri ?? null,
    now,
    now,
  );

  const created = await database.getFirstAsync<ProductRow>(
    `SELECT id, name, category, barcode, photo_uri, purchase_count, status, created_at, updated_at
     FROM products
     WHERE id = ?`,
    result.lastInsertRowId,
  );

  if (!created) {
    throw new Error('PRODUCT_NOT_FOUND_AFTER_INSERT');
  }

  return mapProductRow(created);
}

function mapProductRow(row: ProductRow): ProductRecord {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    barcode: row.barcode,
    photoUri: row.photo_uri,
    purchaseCount: row.purchase_count,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
