import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { isEmptyQuantity, getNextInventoryQuantity, getConsumedQuantity } from "@repona/core";
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
    db
      .insert(inventoryItems)
      .values({ productId: produtoId, quantity: normalizada, status, updatedAt: now })
      .onConflictDoUpdate({
        target: inventoryItems.productId,
        set: { quantity: normalizada, status, updatedAt: now },
      }),
    db.update(products).set({ status: productStatus, updatedAt: now }).where(eq(products.id, produtoId)),
  ]);
}

export async function marcarEmFalta(casaId: number, produtoId: number): Promise<void> {
  await definirQuantidade(casaId, produtoId, "0 un");
}

export async function consumir(casaId: number, produtoId: number): Promise<void> {
  const atual = await obterEstoqueAtual(casaId, produtoId);
  if (isEmptyQuantity(atual)) throw new Error("INVENTORY_ALREADY_MISSING");

  const consumida = getConsumedQuantity(atual);
  const proxima = getNextInventoryQuantity(atual, -1);
  const status = isEmptyQuantity(proxima) ? "missing" : "in_stock";
  const productStatus = status === "missing" ? "missing" : "active";
  const now = new Date();

  // Atômico: registra o evento de consumo + upsert do estoque + status do produto.
  await db.batch([
    db
      .insert(inventoryEvents)
      .values({ productId: produtoId, eventType: "consumed", quantity: consumida }),
    db
      .insert(inventoryItems)
      .values({ productId: produtoId, quantity: proxima, status, updatedAt: now })
      .onConflictDoUpdate({
        target: inventoryItems.productId,
        set: { quantity: proxima, status, updatedAt: now },
      }),
    db.update(products).set({ status: productStatus, updatedAt: now }).where(eq(products.id, produtoId)),
  ]);
}
