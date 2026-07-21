import "server-only";
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import type { PricePoint, PurchaseHistoryDTO } from "@repona/core";
import type { HistoricoCursor } from "@/lib/historicoCursor";
import { db } from "@/server/db";
import { products, shoppingLists, purchaseHistory, priceHistory } from "@/server/db/schema";

export type HistoricoPage = { items: PurchaseHistoryDTO[]; nextCursor: HistoricoCursor | null };

// Histórico por keyset da COMPRA (data + nome de origem), não da linha. Assim
// uma compra com muitos produtos nunca aparece dividida entre páginas. (#87)
export async function listarHistorico(
  casaId: number,
  options: { limit?: number; cursor?: HistoricoCursor } = {}
): Promise<HistoricoPage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const cursorDate = options.cursor ? new Date(options.cursor.purchasedAt) : null;
  const cursorValido =
    cursorDate &&
    !Number.isNaN(cursorDate.getTime()) &&
    typeof options.cursor?.sourceNameKey === "string" &&
    options.cursor.sourceNameKey.length <= 200
      ? options.cursor
      : null;
  const sourceNameKey = sql<string>`coalesce(${purchaseHistory.sourceListName}, ${shoppingLists.name}, '')`;

  const keyRows = await db
    .select({ purchasedAt: purchaseHistory.purchasedAt, sourceNameKey })
    .from(purchaseHistory)
    .leftJoin(shoppingLists, eq(shoppingLists.id, purchaseHistory.sourceListId))
    .where(
      and(
        eq(purchaseHistory.casaId, casaId),
        eq(purchaseHistory.deleted, false),
        cursorValido && cursorDate
          ? or(
              lt(purchaseHistory.purchasedAt, cursorDate),
              and(
                eq(purchaseHistory.purchasedAt, cursorDate),
                gt(sourceNameKey, cursorValido.sourceNameKey)
              )
            )
          : undefined
      )
    )
    .groupBy(purchaseHistory.purchasedAt, sourceNameKey)
    .orderBy(desc(purchaseHistory.purchasedAt), asc(sourceNameKey))
    .limit(limit + 1);

  const hasMore = keyRows.length > limit;
  const pageKeys = hasMore ? keyRows.slice(0, limit) : keyRows;
  if (pageKeys.length === 0) return { items: [], nextCursor: null };

  const rows = await db
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
    .where(
      and(
        // Filtra pela própria coluna que abre o índice; o join de products fica
        // apenas para os atributos exibidos. (#87)
        eq(purchaseHistory.casaId, casaId),
        eq(purchaseHistory.deleted, false),
        or(
          ...pageKeys.map((key) =>
            and(
              eq(purchaseHistory.purchasedAt, key.purchasedAt),
              eq(sourceNameKey, key.sourceNameKey)
            )
          )
        )
      )
    )
    .orderBy(desc(purchaseHistory.purchasedAt), asc(sourceNameKey), asc(purchaseHistory.id));

  const items = rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    category: row.category,
    quantity: row.quantity,
    purchasedAt: row.purchasedAt.toISOString(),
    sourceListId: row.sourceListId,
    sourceListName: row.sourceListName,
  }));
  const last = hasMore ? pageKeys.at(-1) : null;
  return {
    items,
    nextCursor: last
      ? { purchasedAt: last.purchasedAt.toISOString(), sourceNameKey: last.sourceNameKey }
      : null,
  };
}

// Último preço conhecido somente para os produtos da página renderizada.
// Consultar todo o catálogo anulava parte do ganho da paginação do histórico
// em casas com muitos produtos/preços. (#87)
export async function ultimoPrecoPorProduto(
  casaId: number,
  productIds: readonly number[]
): Promise<Map<number, number>> {
  const ids = [...new Set(productIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([priceHistory.productId], {
      productId: priceHistory.productId,
      priceCents: priceHistory.priceCents,
    })
    .from(priceHistory)
    .innerJoin(products, eq(products.id, priceHistory.productId))
    .where(and(eq(products.casaId, casaId), inArray(priceHistory.productId, ids)))
    .orderBy(priceHistory.productId, desc(priceHistory.recordedAt), desc(priceHistory.id));

  return new Map(rows.map((row) => [row.productId, row.priceCents]));
}

// Pontos de preço por produto (até 12 mais recentes cada), para o gráfico de
// evolução na tela de produtos. Objeto simples (não Map) para atravessar a
// fronteira server component → client component.
export async function listarPrecosPorProduto(
  casaId: number
): Promise<Record<number, PricePoint[]>> {
  const result = await db.execute<{
    productId: number;
    priceCents: number;
    recordedAt: Date | string;
  }>(sql`
    select product_id as "productId", price_cents as "priceCents", recorded_at as "recordedAt"
    from (
      select ph.product_id, ph.price_cents, ph.recorded_at,
             row_number() over (
               partition by ph.product_id order by ph.recorded_at desc, ph.id desc
             ) as rn
      from price_history ph
      inner join products p on p.id = ph.product_id
      where p.casa_id = ${casaId}
    ) ranked
    where rn <= 12
    order by product_id, recorded_at desc
  `);

  const mapa: Record<number, PricePoint[]> = {};
  for (const row of result.rows) {
    const lista = (mapa[row.productId] ??= []);
    const recordedAt = row.recordedAt instanceof Date ? row.recordedAt : new Date(row.recordedAt);
    lista.push({ priceCents: row.priceCents, recordedAt: recordedAt.toISOString() });
  }
  return mapa;
}
