import { sql, type SQL } from "drizzle-orm";
import {
  inventoryEvents,
  priceHistory,
  products,
  purchaseHistory,
  shoppingListItems,
  shoppingLists,
} from "../db/schema";
import { isSyncHighWaterMarks, type SyncHighWaterMarks } from "@repona/core";

export type SyncDownloadHighWaterRow = {
  products: number | string;
  purchases: number | string;
  consumptions: number | string;
  prices: number | string;
  list_items: number | string;
  active_list_id: number | string;
};

// Esta consulta deve rodar como o segundo statement da mesma transacao que
// adquiriu o mutex da casa. Em READ COMMITTED, isso garante um snapshot criado
// depois de qualquer writer anterior ter liberado o advisory lock.
export function buildSyncDownloadHighWaterQuery(
  casaId: number
): SQL<SyncDownloadHighWaterRow> {
  return sql<SyncDownloadHighWaterRow>`
    with active_list as materialized (
      select ${shoppingLists.id} as id
      from ${shoppingLists}
      where ${shoppingLists.casaId} = ${casaId}
        and ${shoppingLists.status} = 'active'
      order by ${shoppingLists.createdAt} desc, ${shoppingLists.id} desc
      limit 1
    )
    select
      coalesce((select max(${products.id}) from ${products}
                where ${products.casaId} = ${casaId}), 0)::bigint as products,
      coalesce((select max(${purchaseHistory.id}) from ${purchaseHistory}
                where ${purchaseHistory.casaId} = ${casaId}), 0)::bigint as purchases,
      coalesce((select max(${inventoryEvents.id}) from ${inventoryEvents}
                inner join ${products} p on p.id = ${inventoryEvents.productId}
                where p.casa_id = ${casaId}), 0)::bigint as consumptions,
      coalesce((select max(${priceHistory.id}) from ${priceHistory}
                inner join ${products} p on p.id = ${priceHistory.productId}
                where p.casa_id = ${casaId}), 0)::bigint as prices,
      coalesce((select max(${shoppingListItems.id}) from ${shoppingListItems}
                where ${shoppingListItems.shoppingListId} =
                  (select id from active_list)), 0)::bigint as list_items,
      coalesce((select id from active_list), 0)::bigint as active_list_id
  `;
}

export function syncDownloadHighWaterFromRow(
  row: SyncDownloadHighWaterRow | undefined
): SyncHighWaterMarks {
  const marks = {
    products: Number(row?.products ?? 0),
    purchases: Number(row?.purchases ?? 0),
    consumptions: Number(row?.consumptions ?? 0),
    prices: Number(row?.prices ?? 0),
    listItems: Number(row?.list_items ?? 0),
    activeListId: Number(row?.active_list_id ?? 0),
  };
  if (!isSyncHighWaterMarks(marks)) throw new Error("INVALID_DOWNLOAD_HIGH_WATER");
  return marks;
}
