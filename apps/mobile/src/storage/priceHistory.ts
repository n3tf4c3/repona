import type { PricePoint } from '@repona/core';
import { initializeDatabase } from './database';

const MAX_PRICES_PER_PRODUCT = 10;

// Registra um preço do produto (em centavos) com a data de agora e mantém
// apenas os 10 mais recentes.
export async function addProductPrice(productId: number, priceCents: number) {
  if (!Number.isFinite(priceCents) || priceCents <= 0) {
    throw new Error('PRICE_INVALID');
  }

  const database = await initializeDatabase();
  const now = new Date().toISOString();

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO price_history (product_id, price_cents, recorded_at) VALUES (?, ?, ?)`,
      productId,
      Math.round(priceCents),
      now,
    );

    await database.runAsync(
      `DELETE FROM price_history
       WHERE product_id = ?
         AND id NOT IN (
           SELECT id FROM price_history
           WHERE product_id = ?
           ORDER BY recorded_at DESC, id DESC
           LIMIT ?
         )`,
      productId,
      productId,
      MAX_PRICES_PER_PRODUCT,
    );
  });
}

// Devolve os preços (até 10) de cada produto, agrupados por productId.
export async function listRecentPricesByProduct(): Promise<Map<number, PricePoint[]>> {
  const database = await initializeDatabase();
  const rows = await database.getAllAsync<{ product_id: number; price_cents: number; recorded_at: string }>(`
    SELECT product_id, price_cents, recorded_at
    FROM price_history
    ORDER BY recorded_at DESC, id DESC
  `);

  const map = new Map<number, PricePoint[]>();
  for (const row of rows) {
    const list = map.get(row.product_id) ?? [];
    list.push({ priceCents: row.price_cents, recordedAt: row.recorded_at });
    map.set(row.product_id, list);
  }
  return map;
}
