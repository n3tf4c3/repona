import { isEmptyQuantity } from '@repona/core';
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
  let createdListId = 0;
  try {
    const result = await database.runAsync(
      `INSERT INTO shopping_lists (name, status, created_at, updated_at)
       VALUES ('Compra da Semana', 'active', ?, ?)`,
      now,
      now,
    );
    createdListId = result.lastInsertRowId;
  } catch {
    const active = await database.getFirstAsync<ShoppingListRow>(`
      SELECT id, name, status, created_at, updated_at
      FROM shopping_lists
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    if (active) return mapShoppingListRow(active);
    throw new Error('SHOPPING_LIST_CREATE_FAILED');
  }

  return {
    id: createdListId,
    name: 'Compra da Semana',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

export async function seedActiveShoppingList() {
  const database = await initializeDatabase();
  const listCount = await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM shopping_lists');
  const activeList = await ensureActiveShoppingList();

  if ((listCount?.count ?? 0) > 0) {
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
     WHERE sli.shopping_list_id = ? AND p.archived = 0 AND sli.deleted = 0
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
      (shopping_list_id, product_id, quantity, checked, deleted, created_at, updated_at)
     VALUES (?, ?, '1 un', 0, 0, ?, ?)
     ON CONFLICT(shopping_list_id, product_id)
     DO UPDATE SET
       quantity = CASE WHEN deleted = 1 THEN '1 un' ELSE quantity END,
       checked = CASE WHEN deleted = 1 THEN 0 ELSE checked END,
       deleted = 0,
       updated_at = excluded.updated_at`,
    activeList.id,
    productId,
    now,
    now,
  );
}

export async function createNewActiveShoppingList(): Promise<ShoppingListRecord> {
  const database = await initializeDatabase();
  const listCount = await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM shopping_lists');
  const name = `Lista ${(listCount?.count ?? 0) + 1}`;
  const now = new Date().toISOString();
  let createdListId = 0;

  await database.withTransactionAsync(async () => {
    const anterior = await database.getFirstAsync<{ id: number }>(
      `SELECT id FROM shopping_lists WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`,
    );

    await database.runAsync(
      `UPDATE shopping_lists
       SET status = 'archived',
           updated_at = ?
       WHERE status = 'active'`,
      now,
    );

    const result = await database.runAsync(
      `INSERT INTO shopping_lists (name, status, created_at, updated_at)
       VALUES (?, 'active', ?, ?)`,
      name,
      now,
      now,
    );

    createdListId = result.lastInsertRowId;

    // O sync só transporta a lista ATIVA, sem identidade de lista: se a nova
    // nascesse vazia, o servidor (e os outros devices) continuariam com os itens
    // antigos ativos e o próximo merge re-inseriria tudo aqui ("lista nova que
    // volta cheia"). Copiamos os itens ativos da lista anterior como tombstones
    // (deleted=1) na nova — a limpeza propaga via LWW e a lista permanece vazia
    // em todo lugar. A lista anterior fica intacta. (auditoria 2026-06-09 #4)
    if (anterior) {
      await database.runAsync(
        `INSERT INTO shopping_list_items
           (shopping_list_id, product_id, quantity, checked, deleted, created_at, updated_at)
         SELECT ?, product_id, quantity, checked, 1, ?, ?
         FROM shopping_list_items
         WHERE shopping_list_id = ? AND deleted = 0`,
        createdListId,
        now,
        now,
        anterior.id,
      );
    }
  });

  return {
    id: createdListId,
    name,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
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

export async function updateShoppingListItemQuantity(itemId: number, quantity: string) {
  const database = await initializeDatabase();
  const now = new Date().toISOString();

  await database.runAsync(
    `UPDATE shopping_list_items
     SET quantity = ?,
         updated_at = ?
     WHERE id = ?`,
    quantity,
    now,
    itemId,
  );
}

export async function removeShoppingListItem(itemId: number) {
  const database = await initializeDatabase();
  // Soft-delete: vira tombstone para a remoção propagar no sync. (auditoria #9)
  await database.runAsync(
    'UPDATE shopping_list_items SET deleted = 1, updated_at = ? WHERE id = ?',
    new Date().toISOString(),
    itemId,
  );
}

export async function finalizeActiveShoppingList() {
  const database = await initializeDatabase();
  const activeList = await ensureActiveShoppingList();
  let finalizedCount = 0;

  await database.withTransactionAsync(async () => {
    // Claim atômico: o UPDATE ... RETURNING marca os itens como tombstone
    // (deleted) e os devolve de uma vez. Uma finalização concorrente/retry recebe
    // conjunto vazio e não duplica histórico; quantidade inválida lança e desfaz o
    // UPDATE. O tombstone — em vez de DELETE — faz a finalização propagar no sync
    // sem o item ser ressuscitado por outro device. (auditoria #15, #9)
    const now = new Date().toISOString();
    const comprados = await database.getAllAsync<{ product_id: number; quantity: string }>(
      `UPDATE shopping_list_items
       SET deleted = 1, updated_at = ?
       WHERE shopping_list_id = ? AND checked = 1 AND deleted = 0
         AND product_id IN (SELECT id FROM products WHERE archived = 0)
       RETURNING product_id, quantity`,
      now,
      activeList.id,
    );

    if (comprados.length === 0) {
      return;
    }

    if (comprados.some((item) => isEmptyQuantity(item.quantity))) {
      throw new Error('QUANTITY_INVALID');
    }

    for (const item of comprados) {
      await database.runAsync(
        `INSERT INTO purchase_history (product_id, quantity, purchased_at, source_list_id, source_list_name)
         VALUES (?, ?, ?, ?, ?)`,
        item.product_id,
        item.quantity,
        now,
        activeList.id,
        activeList.name,
      );

      await database.runAsync(
        `UPDATE products
         SET purchase_count = purchase_count + 1,
             status = 'active',
             updated_at = ?
         WHERE id = ?`,
        now,
        item.product_id,
      );

      await database.runAsync(
        `INSERT INTO inventory_items (product_id, quantity, status, created_at, updated_at)
         VALUES (?, ?, 'in_stock', ?, ?)
         ON CONFLICT(product_id)
         DO UPDATE SET quantity = excluded.quantity,
                       status = excluded.status,
                       updated_at = excluded.updated_at`,
        item.product_id,
        item.quantity,
        now,
        now,
      );
    }

    await database.runAsync(
      `UPDATE shopping_lists
       SET updated_at = ?
       WHERE id = ?`,
      now,
      activeList.id,
    );

    finalizedCount = comprados.length;
  });

  return finalizedCount;
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
