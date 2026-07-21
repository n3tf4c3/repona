import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PricePoint, PurchaseHistoryDTO } from "@repona/core";
import { db } from "@/server/db";
import { products, shoppingLists, purchaseHistory, priceHistory } from "@/server/db/schema";

// Histórico de compras da casa, do mais recente ao mais antigo. `limit` opcional
// limita a consulta para paginação — sem ele, devolve tudo (compat). A ordem é
// determinística (purchased_at desc, id asc), então páginas por limite crescente
// são contíguas e estáveis. (auditoria #87)
export async function listarHistorico(
  casaId: number,
  limit?: number
): Promise<PurchaseHistoryDTO[]> {
  const consulta = db
    .select({
      id: purchaseHistory.id,
      productId: purchaseHistory.productId,
      productName: products.name,
      category: products.category,
      quantity: purchaseHistory.quantity,
      purchasedAt: purchaseHistory.purchasedAt,
      sourceListId: purchaseHistory.sourceListId,
      // Prefere o nome denormalizado (sobrevive ao sync); cai no join p/ linhas
      // antigas ainda sem o valor. (auditoria #17)
      sourceListName: sql<string | null>`coalesce(${purchaseHistory.sourceListName}, ${shoppingLists.name})`,
    })
    .from(purchaseHistory)
    .innerJoin(products, eq(products.id, purchaseHistory.productId))
    .leftJoin(shoppingLists, eq(shoppingLists.id, purchaseHistory.sourceListId))
    .where(and(eq(products.casaId, casaId), eq(purchaseHistory.deleted, false)))
    .orderBy(desc(purchaseHistory.purchasedAt), asc(purchaseHistory.id));

  const rows = await (limit !== undefined ? consulta.limit(limit) : consulta);

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

// Último preço conhecido por produto (centavos), para estimar o total da compra
// no histórico — mesma base do "Total estimado" do mobile. (auditoria UI)
export async function ultimoPrecoPorProduto(casaId: number): Promise<Map<number, number>> {
  const rows = await db
    .select({
      productId: priceHistory.productId,
      priceCents: priceHistory.priceCents,
      recordedAt: priceHistory.recordedAt,
    })
    .from(priceHistory)
    .innerJoin(products, eq(products.id, priceHistory.productId))
    .where(eq(products.casaId, casaId))
    .orderBy(desc(priceHistory.recordedAt));

  const mapa = new Map<number, number>();
  for (const row of rows) {
    // Linhas em ordem decrescente: a primeira de cada produto é a mais recente.
    if (!mapa.has(row.productId)) mapa.set(row.productId, row.priceCents);
  }
  return mapa;
}

// Pontos de preço por produto (até 12 mais recentes cada), para o gráfico de
// evolução na tela de produtos. Objeto simples (não Map) para atravessar a
// fronteira server component → client component.
export async function listarPrecosPorProduto(
  casaId: number
): Promise<Record<number, PricePoint[]>> {
  const rows = await db
    .select({
      productId: priceHistory.productId,
      priceCents: priceHistory.priceCents,
      recordedAt: priceHistory.recordedAt,
    })
    .from(priceHistory)
    .innerJoin(products, eq(products.id, priceHistory.productId))
    .where(eq(products.casaId, casaId))
    .orderBy(desc(priceHistory.recordedAt));

  const mapa: Record<number, PricePoint[]> = {};
  for (const row of rows) {
    const lista = (mapa[row.productId] ??= []);
    if (lista.length < 12) {
      lista.push({ priceCents: row.priceCents, recordedAt: row.recordedAt.toISOString() });
    }
  }
  return mapa;
}
