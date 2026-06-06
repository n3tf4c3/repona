import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { isEmptyQuantity, getNextInventoryQuantity, getConsumedQuantity } from "@repona/core";
import { db } from "@/server/db";
import { products, inventoryItems, inventoryEvents } from "@/server/db/schema";

// Garante que o produto pertence ao usuário e devolve a quantidade atual de estoque.
async function obterEstoqueAtual(userId: number, produtoId: number): Promise<string> {
  const [row] = await db
    .select({
      quantity: sql<string>`coalesce(${inventoryItems.quantity}, '0 un')`,
    })
    .from(products)
    .leftJoin(inventoryItems, eq(inventoryItems.productId, products.id))
    .where(and(eq(products.usuarioId, userId), eq(products.id, produtoId)))
    .limit(1);
  if (!row) throw new Error("PRODUCT_NOT_FOUND");
  return row.quantity;
}

async function aplicarQuantidade(produtoId: number, quantity: string): Promise<void> {
  const status = isEmptyQuantity(quantity) ? "missing" : "in_stock";
  const productStatus = status === "missing" ? "missing" : "active";
  const now = new Date();

  await db
    .insert(inventoryItems)
    .values({ productId: produtoId, quantity, status, updatedAt: now })
    .onConflictDoUpdate({
      target: inventoryItems.productId,
      set: { quantity, status, updatedAt: now },
    });

  await db
    .update(products)
    .set({ status: productStatus, updatedAt: now })
    .where(eq(products.id, produtoId));
}

export async function definirQuantidade(
  userId: number,
  produtoId: number,
  quantity: string
): Promise<void> {
  await obterEstoqueAtual(userId, produtoId); // valida posse
  const normalizada = quantity.trim() || "0 un";
  await aplicarQuantidade(produtoId, normalizada);
}

export async function marcarEmFalta(userId: number, produtoId: number): Promise<void> {
  await definirQuantidade(userId, produtoId, "0 un");
}

export async function consumir(userId: number, produtoId: number): Promise<void> {
  const atual = await obterEstoqueAtual(userId, produtoId);
  if (isEmptyQuantity(atual)) throw new Error("INVENTORY_ALREADY_MISSING");

  const consumida = getConsumedQuantity(atual);
  const proxima = getNextInventoryQuantity(atual, -1);

  await db.insert(inventoryEvents).values({
    productId: produtoId,
    eventType: "consumed",
    quantity: consumida,
  });

  await aplicarQuantidade(produtoId, proxima);
}
