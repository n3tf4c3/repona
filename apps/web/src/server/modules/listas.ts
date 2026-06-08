import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { isEmptyQuantity, type ShoppingListDTO, type ShoppingListItemDTO, type ProductStatus } from "@repona/core";
import { db } from "@/server/db";
import {
  products,
  shoppingLists,
  shoppingListItems,
  purchaseHistory,
  inventoryItems,
} from "@/server/db/schema";

export async function garantirListaAtiva(casaId: number): Promise<ShoppingListDTO> {
  const [existente] = await db
    .select()
    .from(shoppingLists)
    .where(and(eq(shoppingLists.casaId, casaId), eq(shoppingLists.status, "active")))
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

  let criada: typeof shoppingLists.$inferSelect | undefined;
  try {
    [criada] = await db
      .insert(shoppingLists)
      .values({ casaId: casaId, name: "Compra da Semana", status: "active" })
      .returning();
  } catch {
    [criada] = await db
      .select()
      .from(shoppingLists)
      .where(and(eq(shoppingLists.casaId, casaId), eq(shoppingLists.status, "active")))
      .orderBy(sql`${shoppingLists.createdAt} desc`)
      .limit(1);
  }

  if (!criada) throw new Error("SHOPPING_LIST_CREATE_FAILED");

  return {
    id: criada.id,
    name: criada.name,
    status: criada.status,
    createdAt: criada.createdAt.toISOString(),
    updatedAt: criada.updatedAt.toISOString(),
  };
}

// Subconsulta dos ids de lista do usuário (para validar posse de itens).
function listasDaCasa(casaId: number) {
  return db
    .select({ id: shoppingLists.id })
    .from(shoppingLists)
    .where(eq(shoppingLists.casaId, casaId));
}

export async function listarItensAtivos(
  casaId: number,
  listaId?: number
): Promise<ShoppingListItemDTO[]> {
  const lista = listaId === undefined ? await garantirListaAtiva(casaId) : { id: listaId };
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
    .where(
      and(
        eq(shoppingListItems.shoppingListId, lista.id),
        eq(products.casaId, casaId),
        // Produto arquivado não participa da lista ativa. (auditoria #8)
        eq(products.archived, false)
      )
    )
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

export async function adicionarProduto(casaId: number, produtoId: number): Promise<void> {
  // Valida posse do produto.
  const [produto] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.casaId, casaId), eq(products.id, produtoId)))
    .limit(1);
  if (!produto) throw new Error("PRODUCT_NOT_FOUND");

  const lista = await garantirListaAtiva(casaId);
  const now = new Date();
  await db
    .insert(shoppingListItems)
    .values({ casaId, shoppingListId: lista.id, productId: produtoId, quantity: "1 un", updatedAt: now })
    .onConflictDoUpdate({
      target: [shoppingListItems.shoppingListId, shoppingListItems.productId],
      set: { updatedAt: now },
    });
}

export async function alternarItem(casaId: number, itemId: number): Promise<void> {
  await db
    .update(shoppingListItems)
    .set({
      checked: sql`not ${shoppingListItems.checked}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        inArray(shoppingListItems.shoppingListId, listasDaCasa(casaId))
      )
    );
}

export async function atualizarQuantidade(
  casaId: number,
  itemId: number,
  quantity: string
): Promise<void> {
  await db
    .update(shoppingListItems)
    .set({ quantity, updatedAt: new Date() })
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        inArray(shoppingListItems.shoppingListId, listasDaCasa(casaId))
      )
    );
}

export async function removerItem(casaId: number, itemId: number): Promise<void> {
  await db
    .delete(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        inArray(shoppingListItems.shoppingListId, listasDaCasa(casaId))
      )
    );
}

export async function finalizarCompra(casaId: number): Promise<number> {
  const lista = await garantirListaAtiva(casaId);
  const marcados = await db
    .select({ productId: shoppingListItems.productId, quantity: shoppingListItems.quantity })
    .from(shoppingListItems)
    .innerJoin(products, eq(products.id, shoppingListItems.productId))
    .where(
      and(
        eq(shoppingListItems.shoppingListId, lista.id),
        eq(shoppingListItems.checked, true),
        eq(products.casaId, casaId),
        // Arquivado não é comprado mesmo que tenha ficado marcado. (auditoria #8)
        eq(products.archived, false)
      )
    )
    .orderBy(asc(shoppingListItems.id));

  if (marcados.length === 0) return 0;
  if (marcados.some((item) => isEmptyQuantity(item.quantity))) throw new Error("QUANTITY_INVALID");

  // Claim atômico: o DELETE ... RETURNING remove e devolve os itens marcados de
  // uma vez. Uma finalização concorrente recebe RETURNING vazio e não duplica o
  // histórico (a leitura acima é só para validar a quantidade). (auditoria #15)
  const comprados = await db
    .delete(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.shoppingListId, lista.id),
        eq(shoppingListItems.checked, true),
        // Não finaliza item de produto arquivado. (auditoria #8)
        inArray(
          shoppingListItems.productId,
          db
            .select({ id: products.id })
            .from(products)
            .where(and(eq(products.casaId, casaId), eq(products.archived, false)))
        )
      )
    )
    .returning({ productId: shoppingListItems.productId, quantity: shoppingListItems.quantity });

  if (comprados.length === 0) return 0;
  const now = new Date();

  // db.batch roda como uma transação: por item comprado grava histórico,
  // incrementa purchase_count e repõe o estoque.
  type Escrita = Parameters<typeof db.batch>[0][number];
  const escritas: Escrita[] = [];
  for (const item of comprados) {
    escritas.push(
      db.insert(purchaseHistory).values({
        casaId,
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
        .where(and(eq(products.casaId, casaId), eq(products.id, item.productId)))
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

  // db.batch exige uma tupla não-vazia; já garantimos comprados.length > 0 acima.
  await db.batch(escritas as unknown as Parameters<typeof db.batch>[0]);

  return comprados.length;
}
