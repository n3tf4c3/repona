import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  type ShoppingListDTO,
  type ShoppingListItemDTO,
  type ProductStatus,
} from "@repona/core";
import { db, queryRaw } from "@/server/db";
import { products, shoppingLists, shoppingListItems } from "@/server/db/schema";
import {
  assertSameDomainOperation,
  DOMAIN_OPERATION_RESULT_MISSING,
  type DomainOperationReceipt,
} from "@/server/modules/domainOperation";
import {
  FINALIZE_PURCHASE_OPERATION_SQL,
  READ_DOMAIN_OPERATION_SQL,
} from "@/server/modules/domainMutationSql";

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
      .values({ casaId: casaId, name: "Lista de Compras", status: "active" })
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
        eq(products.archived, false),
        // Tombstones de sync não aparecem na lista. (auditoria #9)
        eq(shoppingListItems.deleted, false)
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
      // Re-adicionar reativa um tombstone (volta a '1 un', desmarcado); um item já
      // ativo só tem o updatedAt tocado, sem perder quantidade/marca. (auditoria #9)
      set: {
        quantity: sql`case when ${shoppingListItems.deleted} then '1 un' else ${shoppingListItems.quantity} end`,
        checked: sql`case when ${shoppingListItems.deleted} then false else ${shoppingListItems.checked} end`,
        deleted: false,
        updatedAt: now,
      },
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
  // Soft-delete: vira tombstone para a remoção propagar no sync. (auditoria #9)
  await db
    .update(shoppingListItems)
    .set({ deleted: true, updatedAt: new Date() })
    .where(
      and(
        eq(shoppingListItems.id, itemId),
        inArray(shoppingListItems.shoppingListId, listasDaCasa(casaId))
      )
    );
}

export async function finalizarCompra(
  casaId: number,
  operationId: string
): Promise<number> {
  const lista = await garantirListaAtiva(casaId);

  type OperationRow = {
    operationType: string;
    casaId: number | string;
    resourceId: number | string | null;
    resultCount: number | string;
  };
  const toReceipt = (row: OperationRow): DomainOperationReceipt => ({
    operationType: row.operationType,
    casaId: Number(row.casaId),
    resourceId: row.resourceId === null ? null : Number(row.resourceId),
    resultCount: Number(row.resultCount),
  });

  // Claim dos itens e todos os efeitos acontecem numa única instrução. O recibo
  // UNIQUE torna a resposta repetível quando o commit ocorreu mas a conexão caiu:
  // a mesma chave nunca grava compras/estoque/eventos duas vezes. (#22)
  let rows: OperationRow[] = [];
  let queryError: unknown;
  try {
    rows = await queryRaw<OperationRow>(FINALIZE_PURCHASE_OPERATION_SQL, [
      operationId,
      casaId,
      lista.id,
      lista.name,
    ]);
  } catch (error) {
    queryError = error;
  }

  let receipt = rows[0] ? toReceipt(rows[0]) : null;
  if (!receipt) {
    const replay = await queryRaw<OperationRow>(READ_DOMAIN_OPERATION_SQL, [operationId]);
    receipt = replay[0] ? toReceipt(replay[0]) : null;
  }
  if (!receipt) {
    if (queryError) throw queryError;
    throw new Error(DOMAIN_OPERATION_RESULT_MISSING);
  }
  assertSameDomainOperation(receipt, {
    operationType: "finalize-purchase",
    casaId,
    resourceId: lista.id,
  });
  if (receipt.resultCount < 0) throw new Error("QUANTITY_INVALID");
  return receipt.resultCount;
}
