import type { SyncHighWaterMarks } from "@repona/core";

export type DownloadListItemIdentity = {
  id: number;
  itemCasaId: number;
  productCasaId: number;
  shoppingListId: number;
};

// Defesa em profundidade para cursor cliente-controlável: mesmo que um filtro
// SQL seja alterado no futuro, uma lista/Produto de outra casa nunca é serializado.
export function isListItemWithinDownloadScope(
  row: DownloadListItemIdentity,
  casaId: number,
  highWater: SyncHighWaterMarks
): boolean {
  return (
    row.itemCasaId === casaId &&
    row.productCasaId === casaId &&
    row.shoppingListId === highWater.activeListId &&
    row.id <= highWater.listItems
  );
}
