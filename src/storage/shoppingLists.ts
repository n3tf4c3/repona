import { initializeDatabase } from './database';

export type ShoppingListRecord = {
  id: number;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ShoppingListItemRecord = {
  id: number;
  shoppingListId: number;
  productId: number;
  productName: string;
  category: string;
  productStatus: 'active' | 'missing';
  quantity: string;
  checked: boolean;
};

type ShoppingListRow = {
  id: number;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type ShoppingListItemRow = {
  id: number;
  shopping_list_id: number;
  product_id: number;
  product_name: string;
  category: string;
  product_status: 'active' | 'missing';
  quantity: string;
  checked: number;
};

const initialListItems = [
  { productName: 'Maçã Fuji', quantity: '1 kg', checked: true },
  { productName: 'Cenoura', quantity: '500 g', checked: false },
  { productName: 'Leite integral', quantity: '2 un', checked: true },
  { productName: 'Café torrado', quantity: '1 un', checked: false },
];

export async function ensureActiveShoppingList(): Promise<ShoppingListRecord> {
  const database = await initializeDatabase();
  const existing = await database.getFirstAsync<ShoppingListRow>(`
    SELECT id, name, status, created_at, updated_at
    FROM shopping_lists
    WHERE status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `);

  if (existing) {
    return mapShoppingListRow(existing);
  }

  const now = new Date().toISOString();
  const result = await database.runAsync(
    `INSERT INTO shopping_lists (name, status, created_at, updated_at)
     VALUES ('Compra da Semana', 'active', ?, ?)`,
    now,
    now,
  );

  return {
    id: result.lastInsertRowId,
    name: 'Compra da Semana',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

export async function seedActiveShoppingList() {
  const database = await initializeDatabase();
  const activeList = await ensureActiveShoppingList();
  const count = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM shopping_list_items WHERE shopping_list_id = ?',
    activeList.id,
  );

  if ((count?.count ?? 0) > 0) {
    return;
  }

  const now = new Date().toISOString();

  await database.withTransactionAsync(async () => {
    for (const item of initialListItems) {
      const product = await database.getFirstAsync<{ id: number }>(
        'SELECT id FROM products WHERE lower(name) = lower(?) LIMIT 1',
        item.productName,
      );

      if (!product) {
        continue;
      }

      await database.runAsync(
        `INSERT OR IGNORE INTO shopping_list_items
          (shopping_list_id, product_id, quantity, checked, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        activeList.id,
        product.id,
        item.quantity,
        item.checked ? 1 : 0,
        now,
        now,
      );
    }
  });
}

export async function listActiveShoppingItems(): Promise<ShoppingListItemRecord[]> {
  const database = await initializeDatabase();
  const activeList = await ensureActiveShoppingList();
  const rows = await database.getAllAsync<ShoppingListItemRow>(
    `SELECT
       sli.id,
       sli.shopping_list_id,
       sli.product_id,
       p.name as product_name,
       p.category,
       p.status as product_status,
       sli.quantity,
       sli.checked
     FROM shopping_list_items sli
     INNER JOIN products p ON p.id = sli.product_id
     WHERE sli.shopping_list_id = ?
     ORDER BY p.category ASC, sli.checked ASC, p.name ASC`,
    activeList.id,
  );

  return rows.map(mapShoppingListItemRow);
}

export async function addProductToActiveShoppingList(productId: number) {
  const database = await initializeDatabase();
  const activeList = await ensureActiveShoppingList();
  const now = new Date().toISOString();

  await database.runAsync(
    `INSERT INTO shopping_list_items
      (shopping_list_id, product_id, quantity, checked, created_at, updated_at)
     VALUES (?, ?, '1 un', 0, ?, ?)
     ON CONFLICT(shopping_list_id, product_id)
     DO UPDATE SET updated_at = excluded.updated_at`,
    activeList.id,
    productId,
    now,
    now,
  );
}

export async function toggleShoppingListItem(itemId: number) {
  const database = await initializeDatabase();
  const now = new Date().toISOString();

  await database.runAsync(
    `UPDATE shopping_list_items
     SET checked = CASE checked WHEN 1 THEN 0 ELSE 1 END,
         updated_at = ?
     WHERE id = ?`,
    now,
    itemId,
  );
}

function mapShoppingListRow(row: ShoppingListRow): ShoppingListRecord {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapShoppingListItemRow(row: ShoppingListItemRow): ShoppingListItemRecord {
  return {
    id: row.id,
    shoppingListId: row.shopping_list_id,
    productId: row.product_id,
    productName: row.product_name,
    category: row.category,
    productStatus: row.product_status,
    quantity: row.quantity,
    checked: row.checked === 1,
  };
}
