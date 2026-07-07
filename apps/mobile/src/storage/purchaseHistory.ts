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
      COALESCE(ph.source_list_name, sl.name) as source_list_name
    FROM purchase_history ph
    INNER JOIN products p ON p.id = ph.product_id
    LEFT JOIN shopping_lists sl ON sl.id = ph.source_list_id
    WHERE ph.deleted = 0
    ORDER BY ph.purchased_at DESC, ph.id ASC
  `);

  return rows.map(mapPurchaseHistoryRow);
}

export async function addPurchaseHistoryRecord(
  productId: number,
  quantity: string,
  purchasedAt: string,
  sourceListName: string | null,
): Promise<void> {
  const database = await initializeDatabase();
  // Carimbo da edição: é o que faz a re-inclusão vencer um tombstone mais
  // antigo no LWW do sync (shouldApplyIncomingDeleted). (auditoria #65)
  const agora = new Date().toISOString();
  // Re-adicionar o mesmo produto/quantidade/instante revive o tombstone em vez
  // de inserir de novo: duas linhas com a mesma chave de evento (uma viva, uma
  // deleted) fariam o sync re-marcar a viva como excluída.
  const tombstone = await database.getFirstAsync<{ id: number }>(
    `SELECT id FROM purchase_history
     WHERE product_id = ? AND quantity = ? AND purchased_at = ? AND deleted = 1
     LIMIT 1`,
    productId,
    quantity,
    purchasedAt,
  );
  if (tombstone) {
    await database.runAsync(
      'UPDATE purchase_history SET deleted = 0, updated_at = ? WHERE id = ?',
      agora,
      tombstone.id,
    );
  } else {
    // O insert manual também carimba: se outro device tiver um tombstone desta
    // chave que este device nunca viu, a inclusão carimbada vence no merge.
    await database.runAsync(
      `INSERT INTO purchase_history (product_id, quantity, purchased_at, source_list_id, source_list_name, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      productId,
      quantity,
      purchasedAt,
      sourceListName,
      agora,
    );
  }
  await recalcPurchaseCount(database, productId);
}

export async function removePurchaseHistoryRecord(id: number): Promise<void> {
  const database = await initializeDatabase();
  const row = await database.getFirstAsync<{ product_id: number }>(
    'SELECT product_id FROM purchase_history WHERE id = ?',
    id,
  );
  if (!row) return;
  // Tombstone em vez de DELETE: a exclusão precisa propagar no sync sem ser
  // ressuscitada pela nuvem (append-only). Mesmo racional da auditoria #9. O
  // carimbo entra no LWW do sync (auditoria #65).
  await database.runAsync(
    'UPDATE purchase_history SET deleted = 1, updated_at = ? WHERE id = ?',
    new Date().toISOString(),
    id,
  );
  await recalcPurchaseCount(database, row.product_id);
}

// purchase_count é derivado do histórico (auditoria #3): mantém o valor
// consistente após uma edição manual, sem esperar o próximo sync.
async function recalcPurchaseCount(
  database: Awaited<ReturnType<typeof initializeDatabase>>,
  productId: number,
): Promise<void> {
  await database.runAsync(
    `UPDATE products SET purchase_count = (
       SELECT COUNT(*) FROM purchase_history WHERE product_id = ? AND deleted = 0
     ) WHERE id = ?`,
    productId,
    productId,
  );
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
