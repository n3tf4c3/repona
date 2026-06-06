import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { ShoppingListDTO, ShoppingListItemDTO, ProductStatus } from "@repona/core";
import { db } from "@/server/db";
import {
  products,
  shoppingLists,
  shoppingListItems,
  purchaseHistory,
  inventoryItems,
} from "@/server/db/schema";

export async function garantirListaAtiva(userId: number): Promise<ShoppingListDTO> {
  const [existente] = await db
    .select()
    .from(shoppingLists)
    .where(and(eq(shoppingLists.usuarioId, userId), eq(shoppingLists.status, "active")))
    .orderBy(sql`${shoppingLists.createdAt} desc`)
    .limit(1);

  if (existente) {
    return {
      id: existente.id,
      name: existente.name,
      status: existente.status,
      createdAt: existente.createdAt.toISOString(),
      updatedAt: existente.updatedAt.toISOString(),
    };
  }

  const [criada] = await db
    .insert(shoppingLists)
    .values({ usuarioId: userId, name: "Compra da Semana", status: "active" })
    .returning();

  return {
    id: criada.id,
    name: criada.name,
    status: criada.status,
    createdAt: criada.createdAt.toISOString(),
    updatedAt: criada.updatedAt.toISOString(),
  };
}

// Subconsulta dos ids de lista do usuário (para validar posse de itens).
function listasDoUsuario(userId: number) {
  return db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(eq(shoppingLists.usuarioId, userId));
}

export async function listarItensAtivos(userId: number): Promise<ShoppingListItemDTO[]> {
  const lista = await garantirListaAtiva(userId);
  const rows = await db
    .select({
      id: shoppingListItems.id,
      shoppingListId: shoppingListItems.shoppingListId,
      productId: shoppingListItems.productId,
      productName: products.name,
      category: products.category,
      productStatus: products.status,
      quantity: shoppingListItems.quantity,
      checked: shoppingListItems.checked,
    })
    .from(shoppingListItems)
    .innerJoin(products, eq(products.id, shoppingListItems.productId))
    .where(eq(shoppingListItems.shoppingListId, lista.id))
    .orderBy(asc(products.category), asc(shoppingListItems.checked), asc(products.name));

  return rows.map((row) => ({
    id: row.id,
    shoppingListId: row.shoppingListId,
    productId: row.productId,
    productName: row.productName,
    category: row.category,
    productStatus: row.productStatus as ProductStatus,
    quantity: row.quantity,
    checked: row.checked,
  }));
}

export async function adicionarProduto(userId: number, produtoId: number): Promise<void> {
  // Valida posse do produto.
  const [produto] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.usuarioId, userId), eq(products.id, produtoId)))
    .limit(1);
  if (!produto) throw new Error("PRODUCT_NOT_FOUND");

  const lista = await garantirListaAtiva(userId);
  const now = new Date();
  await db
    .insert(shoppingListItems)
    .values({ shoppingListId: lista.id, productId: produtoId, quantity: "1 un", updatedAt: now })
    .onConflictDoUpdate({
      target: [shoppingListItems.shoppingListId, shoppingListItems.productId],
      set: { updatedAt: now },
    });
}

export async function alternarItem(userId: number, itemId: number): Promise<void> {
  await db
    .update(shoppingListItems)
    .set({
      checked: sql`not ${shoppingListItems.checked}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        inArray(shoppingListItems.shoppingListId, listasDoUsuario(userId))
      )
    );
}

export async function atualizarQuantidade(
  userId: number,
  itemId: number,
  quantity: string
): Promise<void> {
  await db
    .update(shoppingListItems)
    .set({ quantity, updatedAt: new Date() })
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        inArray(shoppingListItems.shoppingListId, listasDoUsuario(userId))
      )
    );
}

export async function removerItem(userId: number, itemId: number): Promise<void> {
  await db
    .delete(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        inArray(shoppingListItems.shoppingListId, listasDoUsuario(userId))
      )
    );
}

export async function finalizarCompra(userId: number): Promise<number> {
  const lista = await garantirListaAtiva(userId);
  const marcados = await db
    .select({ productId: shoppingListItems.productId, quantity: shoppingListItems.quantity })
    .from(shoppingListItems)
    .where(and(eq(shoppingListItems.shoppingListId, lista.id), eq(shoppingListItems.checked, true)))
    .orderBy(asc(shoppingListItems.id));

  if (marcados.length === 0) return 0;
  const now = new Date();

  // Tudo numa transação (db.batch): por item marcado grava histórico, incrementa
  // purchase_count, repõe o estoque; ao final remove os itens comprados da lista.
  type Escrita = Parameters<typeof db.batch>[0][number];
  const escritas: Escrita[] = [];
  for (const item of marcados) {
    escritas.push(
      db.insert(purchaseHistory).values({
        productId: item.productId,
        quantity: item.quantity,
        purchasedAt: now,
        sourceListId: lista.id,
      })
    );
    escritas.push(
      db
        .update(products)
        .set({
          purchaseCount: sql`${products.purchaseCount} + 1`,
          status: "active",
          updatedAt: now,
        })
        .where(eq(products.id, item.productId))
    );
    escritas.push(
      db
        .insert(inventoryItems)
        .values({ productId: item.productId, quantity: item.quantity, status: "in_stock", updatedAt: now })
        .onConflictDoUpdate({
          target: inventoryItems.productId,
          set: { quantity: item.quantity, status: "in_stock", updatedAt: now },
        })
    );
  }
  escritas.push(
    db
      .delete(shoppingListItems)
      .where(and(eq(shoppingListItems.shoppingListId, lista.id), eq(shoppingListItems.checked, true)))
  );

  // db.batch exige uma tupla não-vazia; já garantimos length > 0 acima.
  await db.batch(escritas as unknown as Parameters<typeof db.batch>[0]);

  return marcados.length;
}
