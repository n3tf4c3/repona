import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { isEmptyQuantity, getNextInventoryQuantity, getConsumedQuantity, uuidv4 } from "@repona/core";
import { db } from "@/server/db";
import { products, inventoryItems, inventoryEvents } from "@/server/db/schema";

// Garante que o produto pertence ao usuário e devolve a quantidade atual de estoque.
async function obterEstoqueAtual(casaId: number, produtoId: number): Promise<string> {
  const [row] = await db
    .select({
      quantity: sql<string>`coalesce(${inventoryItems.quantity}, '0 un')`,
    })
    .from(products)
    .leftJoin(inventoryItems, eq(inventoryItems.productId, products.id))
    .where(and(eq(products.casaId, casaId), eq(products.id, produtoId)))
    .limit(1);
  if (!row) throw new Error("PRODUCT_NOT_FOUND");
  return row.quantity;
}

export async function definirQuantidade(
  casaId: number,
  produtoId: number,
  quantity: string
): Promise<void> {
  await obterEstoqueAtual(casaId, produtoId); // valida posse
  const normalizada = quantity.trim() || "0 un";
  const status = isEmptyQuantity(normalizada) ? "missing" : "in_stock";
  const productStatus = status === "missing" ? "missing" : "active";
  const now = new Date();

  // Atômico (db.batch = uma transação): upsert do estoque + status do produto.
  await db.batch([
    db.insert(inventoryEvents).values({
      syncId: uuidv4(),
      productId: produtoId,
      eventType: "set",
      quantity: normalizada,
      occurredAt: now,
    }),
    db
      .insert(inventoryItems)
      .values({ productId: produtoId, quantity: normalizada, status, updatedAt: now })
      .onConflictDoUpdate({
        target: inventoryItems.productId,
        set: { quantity: normalizada, status, updatedAt: now },
      }),
    db
      .update(products)
      .set({ status: productStatus })
      .where(and(eq(products.casaId, casaId), eq(products.id, produtoId))),
  ]);
}

export async function marcarEmFalta(casaId: number, produtoId: number): Promise<void> {
  await definirQuantidade(casaId, produtoId, "0 un");
}

export async function consumir(casaId: number, produtoId: number): Promise<void> {
  // Decremento com compare-and-set para evitar lost update: duas chamadas
  // concorrentes liam a mesma quantidade e gravavam o mesmo valor absoluto,
  // perdendo um decremento (mas registrando dois eventos). O UPDATE só vence se
  // a quantidade ainda for a lida; quem perde a corrida tenta de novo com o
  // valor novo. Mesmo padrão de claim+efeitos de finalizarCompra. (auditoria #27)
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const atual = await obterEstoqueAtual(casaId, produtoId);
    if (isEmptyQuantity(atual)) throw new Error("INVENTORY_ALREADY_MISSING");

    const consumida = getConsumedQuantity(atual);
    const proxima = getNextInventoryQuantity(atual, -1);
    const status = isEmptyQuantity(proxima) ? "missing" : "in_stock";
    const productStatus = status === "missing" ? "missing" : "active";
    const now = new Date();

    // Claim do estoque: decrementa só se a quantidade não mudou desde a leitura.
    const claim = await db
      .update(inventoryItems)
      .set({ quantity: proxima, status, updatedAt: now })
      .where(and(eq(inventoryItems.productId, produtoId), eq(inventoryItems.quantity, atual)))
      .returning({ productId: inventoryItems.productId });
    if (claim.length === 0) continue; // outra consumir venceu; recomputa

    // Só após vencer o claim: registra o evento e o status do produto. Se o batch
    // falhar, o estoque já baixou sem evento/status — desfaz o claim (compare-and
    // -set: só reverte se a quantidade ainda for a que gravamos). Mesma família do
    // #22, sem transação interativa no neon-http. (auditoria #42)
    try {
      await db.batch([
        db
          .insert(inventoryEvents)
          .values({ syncId: uuidv4(), productId: produtoId, eventType: "consumed", quantity: consumida }),
        db
          .update(products)
          .set({ status: productStatus })
          .where(and(eq(products.casaId, casaId), eq(products.id, produtoId))),
      ]);
    } catch (error) {
      // atual é não-vazio (checado acima), então o estoque revertido é in_stock.
      await db
        .update(inventoryItems)
        .set({ quantity: atual, status: "in_stock", updatedAt: new Date() })
        .where(and(eq(inventoryItems.productId, produtoId), eq(inventoryItems.quantity, proxima)));
      throw error;
    }
    return;
  }
  throw new Error("INVENTORY_CONFLICT");
}
