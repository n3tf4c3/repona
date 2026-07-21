import { uuidv4 } from '@repona/core';
import {
  createPurchaseHistoryKeyWindow,
  normalizePurchaseHistoryCursor,
  normalizePurchaseHistoryLimit,
  type PurchaseHistoryCursor,
} from '../purchaseHistoryPagination';
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

type PurchaseHistoryKeyRow = {
  purchased_at: string;
  source_name_key: string;
};

export type PurchaseHistoryPage = {
  records: PurchaseHistoryRecord[];
  nextCursor: PurchaseHistoryCursor | null;
};

export async function listPurchaseHistoryPage(
  options: { limit?: number; cursor?: PurchaseHistoryCursor | null } = {},
): Promise<PurchaseHistoryPage> {
  const database = await initializeDatabase();
  const limit = normalizePurchaseHistoryLimit(options.limit);
  const cursor = normalizePurchaseHistoryCursor(options.cursor);
  const cursorCondition = cursor
    ? `AND (
         ph.purchased_at < ?
         OR (ph.purchased_at = ? AND COALESCE(ph.source_list_name, sl.name, '') > ?)
       )`
    : '';
  const cursorArguments = cursor
    ? [cursor.purchasedAt, cursor.purchasedAt, cursor.sourceNameKey]
    : [];

  // Primeiro pagina as CHAVES de compra. Assim, uma compra com muitas linhas
  // nunca é cortada no meio e só as linhas das compras desta página são lidas.
  const keyRows = await database.getAllAsync<PurchaseHistoryKeyRow>(
    `SELECT
       ph.purchased_at,
       COALESCE(ph.source_list_name, sl.name, '') AS source_name_key
     FROM purchase_history ph
     LEFT JOIN shopping_lists sl ON sl.id = ph.source_list_id
     WHERE ph.deleted = 0
       ${cursorCondition}
     GROUP BY ph.purchased_at, COALESCE(ph.source_list_name, sl.name, '')
     ORDER BY ph.purchased_at DESC, source_name_key ASC
     LIMIT ?`,
    ...cursorArguments,
    limit + 1,
  );
  const window = createPurchaseHistoryKeyWindow(
    keyRows.map((row) => ({
      purchasedAt: row.purchased_at,
      sourceNameKey: row.source_name_key,
    })),
    limit,
  );

  if (window.keys.length === 0) {
    return { records: [], nextCursor: null };
  }

  const keyConditions = window.keys
    .map(
      () =>
        `(ph.purchased_at = ? AND COALESCE(ph.source_list_name, sl.name, '') = ?)`,
    )
    .join(' OR ');
  const keyArguments = window.keys.flatMap((key) => [key.purchasedAt, key.sourceNameKey]);
  const rows = await database.getAllAsync<PurchaseHistoryRow>(
    `
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
    WHERE ph.deleted = 0 AND (${keyConditions})
    ORDER BY
      ph.purchased_at DESC,
      COALESCE(ph.source_list_name, sl.name, '') ASC,
      ph.id ASC
    `,
    ...keyArguments,
  );

  return { records: rows.map(mapPurchaseHistoryRow), nextCursor: window.nextCursor };
}

export async function listPurchaseHistoryGroupRecords(
  purchasedAt: string,
  sourceListName: string | null,
): Promise<PurchaseHistoryRecord[]> {
  const database = await initializeDatabase();
  const rows = await database.getAllAsync<PurchaseHistoryRow>(
    `SELECT
       ph.id,
       ph.product_id,
       p.name AS product_name,
       p.category,
       ph.quantity,
       ph.purchased_at,
       ph.source_list_id,
       COALESCE(ph.source_list_name, sl.name) AS source_list_name
     FROM purchase_history ph
     INNER JOIN products p ON p.id = ph.product_id
     LEFT JOIN shopping_lists sl ON sl.id = ph.source_list_id
     WHERE ph.deleted = 0
       AND ph.purchased_at = ?
       AND COALESCE(ph.source_list_name, sl.name, '') = ?
     ORDER BY ph.id ASC`,
    purchasedAt,
    sourceListName ?? '',
  );
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
      `INSERT INTO purchase_history (sync_id, product_id, quantity, purchased_at, source_list_id, source_list_name, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      uuidv4(),
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
