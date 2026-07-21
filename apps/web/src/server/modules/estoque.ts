import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { isEmptyQuantity, uuidv4 } from "@repona/core";
import { db, queryRaw, transactionRaw } from "@/server/db";
import { products, inventoryItems, inventoryEvents } from "@/server/db/schema";
import {
  assertSameDomainOperation,
  DOMAIN_OPERATION_RESULT_MISSING,
  type DomainOperationReceipt,
} from "@/server/modules/domainOperation";
import {
  CONSUME_DOMAIN_OPERATION_SQL,
  READ_DOMAIN_OPERATION_SQL,
} from "@/server/modules/domainMutationSql";
import {
  buildCasaMutationLock,
  casaMutationLockRawQuery,
} from "@/server/modules/casaMutationLock";

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
    db.execute(buildCasaMutationLock(casaId)),
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

type OperationRow = {
  operationType: string;
  casaId: number | string;
  resourceId: number | string | null;
  resultCount: number | string;
};

function toReceipt(row: OperationRow): DomainOperationReceipt {
  return {
    operationType: row.operationType,
    casaId: Number(row.casaId),
    resourceId: row.resourceId === null ? null : Number(row.resourceId),
    resultCount: Number(row.resultCount),
  };
}

async function obterRecibo(operationId: string): Promise<DomainOperationReceipt | null> {
  const rows = await queryRaw<OperationRow>(READ_DOMAIN_OPERATION_SQL, [operationId]);
  return rows[0] ? toReceipt(rows[0]) : null;
}

export async function consumir(
  casaId: number,
  produtoId: number,
  operationId: string
): Promise<void> {
  // Uma única instrução PostgreSQL cria o recibo idempotente, bloqueia o saldo,
  // calcula/decrementa, grava o evento e atualiza o cache de status. Qualquer erro
  // desfaz tudo; retry com a mesma chave apenas lê o resultado persistido. (#22)
  let rows: OperationRow[] = [];
  let queryError: unknown;
  try {
    const [, operationRows] = await transactionRaw([
      casaMutationLockRawQuery(casaId),
      {
        query: CONSUME_DOMAIN_OPERATION_SQL,
        params: [operationId, casaId, produtoId],
      },
    ]);
    rows = operationRows as OperationRow[];
  } catch (error) {
    // Duas requisições simultâneas com a mesma chave podem disputar o UNIQUE
    // do evento/recibo. A perdedora lê o recibo que a vencedora acabou de
    // commitar; erros sem recibo continuam sendo propagados.
    queryError = error;
  }

  const receipt = rows[0] ? toReceipt(rows[0]) : await obterRecibo(operationId);
  if (!receipt) {
    if (queryError) throw queryError;
    throw new Error(DOMAIN_OPERATION_RESULT_MISSING);
  }
  assertSameDomainOperation(receipt, {
    operationType: "consume",
    casaId,
    resourceId: produtoId,
  });
  if (receipt.resultCount !== 1) throw new Error("INVENTORY_ALREADY_MISSING");
}
