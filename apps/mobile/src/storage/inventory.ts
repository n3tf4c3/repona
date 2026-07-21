import { isEmptyQuantity, getNextInventoryQuantity, getConsumedQuantity, uuidv4 } from '@repona/core';
import { initializeDatabase } from './database';

export type InventoryStatus = 'in_stock' | 'missing';

export async function setProductInventoryQuantity(productId: number, quantity: string) {
  const database = await initializeDatabase();
  const normalizedQuantity = quantity.trim() || '0 un';
  const status = isEmptyQuantity(normalizedQuantity) ? 'missing' : 'in_stock';
  const productStatus = status === 'missing' ? 'missing' : 'active';
  const now = new Date().toISOString();

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO inventory_events (sync_id, product_id, event_type, quantity, occurred_at)
       VALUES (?, ?, 'set', ?, ?)`,
      uuidv4(),
      productId,
      normalizedQuantity,
      now,
    );

    await database.runAsync(
      `INSERT INTO inventory_items (product_id, quantity, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(product_id)
       DO UPDATE SET quantity = excluded.quantity,
                     status = excluded.status,
                     updated_at = excluded.updated_at`,
      productId,
      normalizedQuantity,
      status,
      now,
      now,
    );

    await database.runAsync(
      `UPDATE products
       SET status = ?
       WHERE id = ?`,
      productStatus,
      productId,
    );
  });
}

export async function markProductInventoryMissing(productId: number) {
  await setProductInventoryQuantity(productId, '0 un');
}

export async function consumeProductInventory(productId: number, currentQuantity: string) {
  const consumedQuantity = getConsumedQuantity(currentQuantity);
  const nextQuantity = getNextInventoryQuantity(currentQuantity, -1);
  const status = isEmptyQuantity(nextQuantity) ? 'missing' : 'in_stock';
  const productStatus = status === 'missing' ? 'missing' : 'active';
  const now = new Date().toISOString();

  if (isEmptyQuantity(currentQuantity)) {
    throw new Error('INVENTORY_ALREADY_MISSING');
  }

  const database = await initializeDatabase();

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO inventory_events (sync_id, product_id, event_type, quantity, occurred_at)
       VALUES (?, ?, 'consumed', ?, ?)`,
      uuidv4(),
      productId,
      consumedQuantity,
      now,
    );

    await database.runAsync(
      `INSERT INTO inventory_items (product_id, quantity, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(product_id)
       DO UPDATE SET quantity = excluded.quantity,
                     status = excluded.status,
                     updated_at = excluded.updated_at`,
      productId,
      nextQuantity,
      status,
      now,
      now,
    );

    await database.runAsync(
      `UPDATE products
       SET status = ?
       WHERE id = ?`,
      productStatus,
      productId,
    );
  });
}
