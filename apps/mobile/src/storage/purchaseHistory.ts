import { initializeDatabase } from './database';

export type PurchaseHistoryRecord = {
  id: number;
  productId: number;
  productName: string;
  category: string;
  quantity: string;
  purchasedAt: string;
  sourceListId: number | null;
  sourceListName: string | null;
};

type PurchaseHistoryRow = {
  id: number;
  product_id: number;
  product_name: string;
  category: string;
  quantity: string;
  purchased_at: string;
  source_list_id: number | null;
  source_list_name: string | null;
};

export async function listPurchaseHistoryRecords(): Promise<PurchaseHistoryRecord[]> {
  const database = await initializeDatabase();
  const rows = await database.getAllAsync<PurchaseHistoryRow>(`
    SELECT
      ph.id,
      ph.product_id,
      p.name as product_name,
      p.category,
      ph.quantity,
      ph.purchased_at,
      ph.source_list_id,
      sl.name as source_list_name
    FROM purchase_history ph
    INNER JOIN products p ON p.id = ph.product_id
    LEFT JOIN shopping_lists sl ON sl.id = ph.source_list_id
    ORDER BY ph.purchased_at DESC, ph.id ASC
  `);

  return rows.map(mapPurchaseHistoryRow);
}

function mapPurchaseHistoryRow(row: PurchaseHistoryRow): PurchaseHistoryRecord {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    category: row.category,
    quantity: row.quantity,
    purchasedAt: row.purchased_at,
    sourceListId: row.source_list_id,
    sourceListName: row.source_list_name,
  };
}
