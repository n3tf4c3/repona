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
       SET status = ?,
           updated_at = ?
       WHERE id = ?`,
      productStatus,
      now,
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
      `INSERT INTO inventory_events (product_id, event_type, quantity, occurred_at)
       VALUES (?, 'consumed', ?, ?)`,
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
       SET status = ?,
           updated_at = ?
       WHERE id = ?`,
      productStatus,
      now,
      productId,
    );
  });
}

function isEmptyQuantity(quantity: string) {
  const match = quantity.match(/^(\d+(?:[.,]\d+)?)/);

  if (!match) {
    return false;
  }

  return Number(match[1].replace(',', '.')) <= 0;
}

function getNextInventoryQuantity(quantity: string, direction: 1 | -1) {
  const match = quantity.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);

  if (!match) {
    return direction > 0 ? '1 un' : '0 un';
  }

  const currentValue = Number(match[1].replace(',', '.'));
  const unit = match[2].trim() || 'un';
  const step = unit === 'g' ? 100 : 1;
  const nextValue = Math.max(0, currentValue + direction * step);
  const formattedValue = Number.isInteger(nextValue) ? `${nextValue}` : `${nextValue.toFixed(1).replace('.', ',')}`;

  return `${formattedValue} ${unit}`;
}

function getConsumedQuantity(quantity: string) {
  const match = quantity.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  const currentValue = match ? Number(match[1].replace(',', '.')) : 1;
  const unit = match?.[2].trim() || 'un';
  const step = unit === 'g' ? 100 : 1;
  const consumedValue = Math.min(currentValue, step);
  const formattedValue = Number.isInteger(consumedValue) ? `${consumedValue}` : `${consumedValue.toFixed(1).replace('.', ',')}`;

  return `${formattedValue} ${unit}`;
}
