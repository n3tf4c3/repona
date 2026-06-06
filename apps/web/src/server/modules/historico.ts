import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import type { PurchaseHistoryDTO } from "@repona/core";
import { db } from "@/server/db";
import { products, shoppingLists, purchaseHistory } from "@/server/db/schema";

export async function listarHistorico(casaId: number): Promise<PurchaseHistoryDTO[]> {
  const rows = await db
    .select({
      id: purchaseHistory.id,
      productId: purchaseHistory.productId,
      productName: products.name,
      category: products.category,
      quantity: purchaseHistory.quantity,
      purchasedAt: purchaseHistory.purchasedAt,
      sourceListId: purchaseHistory.sourceListId,
      sourceListName: shoppingLists.name,
    })
    .from(purchaseHistory)
    .innerJoin(products, eq(products.id, purchaseHistory.productId))
    .leftJoin(shoppingLists, eq(shoppingLists.id, purchaseHistory.sourceListId))
    .where(eq(products.casaId, casaId))
    .orderBy(desc(purchaseHistory.purchasedAt), asc(purchaseHistory.id));

  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    category: row.category,
    quantity: row.quantity,
    purchasedAt: row.purchasedAt.toISOString(),
    sourceListId: row.sourceListId,
    sourceListName: row.sourceListName,
  }));
}
