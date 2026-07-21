import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  type ShoppingListDTO,
  type ShoppingListItemDTO,
  type ProductStatus,
} from "@repona/core";
import { db, queryRaw, transactionRaw } from "@/server/db";
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
import {
  buildCasaMutationLock,
  casaMutationLockRawQuery,
} from "@/server/modules/casaMutationLock";

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
    const [, criadas] = await db.batch([
      db.execute(buildCasaMutationLock(casaId)),
      db
        .insert(shoppingLists)
        .values({ casaId: casaId, name: "Lista de Compras", status: "active" })
        .returning(),
    ]);
    [criada] = criadas;
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

  await garantirListaAtiva(casaId);
  const now = new Date();
  await db.batch([
    db.execute(buildCasaMutationLock(casaId)),
    // A lista ativa e escolhida DEPOIS do mutex, dentro da mesma transacao. Se
    // ela mudou enquanto a validacao de produto rodava, nunca inserimos na
    // lista antiga. (#74)
    db.execute(sql`
      insert into shopping_list_items
        (casa_id, shopping_list_id, product_id, quantity, checked, deleted, updated_at)
      select ${casaId}, active.id, ${produtoId}, '1 un', false, false, ${now}
      from shopping_lists active
      where active.casa_id = ${casaId} and active.status = 'active'
      order by active.created_at desc
      limit 1
      on conflict (shopping_list_id, product_id) do update set
        quantity = case
          when shopping_list_items.deleted then '1 un'
          else shopping_list_items.quantity
        end,
        checked = case
          when shopping_list_items.deleted then false
          else shopping_list_items.checked
        end,
        deleted = false,
        updated_at = ${now}
    `),
  ]);
}

export async function alternarItem(casaId: number, itemId: number): Promise<void> {
  await db.batch([
    db.execute(buildCasaMutationLock(casaId)),
    db
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
      ),
  ]);
}

export async function atualizarQuantidade(
  casaId: number,
  itemId: number,
  quantity: string
): Promise<void> {
  await db.batch([
    db.execute(buildCasaMutationLock(casaId)),
    db
      .update(shoppingListItems)
      .set({ quantity, updatedAt: new Date() })
      .where(
        and(
          eq(shoppingListItems.id, itemId),
          inArray(shoppingListItems.shoppingListId, listasDaCasa(casaId))
        )
      ),
  ]);
}

export async function removerItem(casaId: number, itemId: number): Promise<void> {
  // Soft-delete: vira tombstone para a remoção propagar no sync. (auditoria #9)
  await db.batch([
    db.execute(buildCasaMutationLock(casaId)),
    db
      .update(shoppingListItems)
      .set({ deleted: true, updatedAt: new Date() })
      .where(
        and(
          eq(shoppingListItems.id, itemId),
          inArray(shoppingListItems.shoppingListId, listasDaCasa(casaId))
        )
      ),
  ]);
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
    const [, operationRows] = await transactionRaw([
      casaMutationLockRawQuery(casaId),
      {
        query: FINALIZE_PURCHASE_OPERATION_SQL,
        params: [operationId, casaId, lista.id, lista.name],
      },
    ]);
    rows = operationRows as OperationRow[];
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
    // A lista efetiva e escolhida dentro do statement, depois do mutex. Em retry,
    // o recibo preserva a lista original mesmo que outra esteja ativa agora.
    resourceId: receipt.resourceId ?? lista.id,
  });
  if (receipt.resultCount < 0) throw new Error("QUANTITY_INVALID");
  return receipt.resultCount;
}
