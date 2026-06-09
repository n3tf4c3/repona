import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { isEmptyQuantity, validateProductFields, type ProductDTO, type NewProductInput, type ProductStatus, type InventoryStatus } from "@repona/core";
import { db } from "@/server/db";
import { products, inventoryItems, inventoryEvents } from "@/server/db/schema";

// Subconsulta de consumo agregado (eventos 'consumed') por produto.
function consumoSubquery() {
  return db
    .select({
      productId: inventoryEvents.productId,
      consumptionCount: sql<number>`count(*)::int`.as("consumption_count"),
      lastConsumedAt: sql<Date | null>`max(${inventoryEvents.occurredAt})`.as("last_consumed_at"),
    })
    .from(inventoryEvents)
    .where(eq(inventoryEvents.eventType, "consumed"))
    .groupBy(inventoryEvents.productId)
    .as("consumo");
}

type ProdutoRow = {
  id: number;
  name: string;
  category: string;
  barcode: string | null;
  photoUri: string | null;
  purchaseCount: number;
  status: string;
  alertThreshold: string | null;
  inventoryQuantity: string;
  inventoryStatus: string;
  consumptionCount: number;
  lastConsumedAt: Date | null;
  archived: boolean;
  occasional: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function selecionarProdutos(casaId: number, opts?: { id?: number; arquivado?: boolean }) {
  const consumo = consumoSubquery();
  const conds = [eq(products.casaId, casaId)];
  if (opts?.id !== undefined) conds.push(eq(products.id, opts.id));
  if (opts?.arquivado !== undefined) conds.push(eq(products.archived, opts.arquivado));
  const filtro = and(...conds);
  return db
    .select({
      id: products.id,
      name: products.name,
      category: products.category,
      barcode: products.barcode,
      photoUri: products.photoUri,
      purchaseCount: products.purchaseCount,
      status: products.status,
      alertThreshold: products.alertThreshold,
      inventoryQuantity: sql<string>`coalesce(${inventoryItems.quantity}, '0 un')`,
      inventoryStatus: sql<string>`coalesce(${inventoryItems.status}, 'missing')`,
      consumptionCount: sql<number>`coalesce(${consumo.consumptionCount}, 0)`,
      lastConsumedAt: consumo.lastConsumedAt,
      archived: products.archived,
      occasional: products.occasional,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .leftJoin(inventoryItems, eq(inventoryItems.productId, products.id))
    .leftJoin(consumo, eq(consumo.productId, products.id))
    .where(filtro);
}

function mapProduto(row: ProdutoRow): ProductDTO {
  const estoqueVazio = isEmptyQuantity(row.inventoryQuantity);
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    barcode: row.barcode,
    photoUri: row.photoUri,
    purchaseCount: row.purchaseCount,
    status: estoqueVazio ? "missing" : (row.status as ProductStatus),
    alertThreshold: row.alertThreshold,
    inventoryQuantity: row.inventoryQuantity,
    inventoryStatus: estoqueVazio ? "missing" : (row.inventoryStatus as InventoryStatus),
    consumptionCount: row.consumptionCount,
    // max(occurred_at) volta como string no neon-http (nao Date como nas colunas
    // de timestamp), entao normalizamos via Date antes de serializar.
    lastConsumedAt: row.lastConsumedAt ? new Date(row.lastConsumedAt).toISOString() : null,
    archived: row.archived,
    occasional: row.occasional,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Ordem alfabética (case-insensitive): determinística entre dispositivos. Antes
// era por created_at desc, que é local e embaralhava após re-pull. (auditoria
// 2026-06-09 #6)
export async function listProdutos(casaId: number): Promise<ProductDTO[]> {
  const rows = await selecionarProdutos(casaId, { arquivado: false }).orderBy(
    asc(sql`lower(${products.name})`)
  );
  return rows.map(mapProduto);
}

export async function listProdutosArquivados(casaId: number): Promise<ProductDTO[]> {
  const rows = await selecionarProdutos(casaId, { arquivado: true }).orderBy(
    asc(sql`lower(${products.name})`)
  );
  return rows.map(mapProduto);
}

async function getProdutoDTO(casaId: number, id: number): Promise<ProductDTO | null> {
  const [row] = await selecionarProdutos(casaId, { id });
  return row ? mapProduto(row) : null;
}

async function nomeJaExiste(casaId: number, name: string, exceptId?: number): Promise<boolean> {
  const condicoes = [eq(products.casaId, casaId), sql`lower(${products.name}) = lower(${name})`];
  if (exceptId !== undefined) condicoes.push(ne(products.id, exceptId));
  const [existente] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(...condicoes))
    .limit(1);
  return Boolean(existente);
}

// Outro produto da casa já usa este código de barras. Impede duplicata local por
// barcode (o sync já casa por barcode; aqui fechamos a criação). (auditoria #1)
async function barcodeJaExiste(casaId: number, barcode: string, exceptId?: number): Promise<boolean> {
  const condicoes = [eq(products.casaId, casaId), eq(products.barcode, barcode)];
  if (exceptId !== undefined) condicoes.push(ne(products.id, exceptId));
  const [existente] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(...condicoes))
    .limit(1);
  return Boolean(existente);
}

export async function createProduto(casaId: number, input: NewProductInput): Promise<ProductDTO> {
  const name = input.name.trim();
  const category = input.category.trim();
  if (!name) throw new Error("PRODUCT_NAME_REQUIRED");
  validateProductFields(input);
  if (await nomeJaExiste(casaId, name)) throw new Error("PRODUCT_ALREADY_EXISTS");
  const barcode = input.barcode?.trim() || null;
  if (barcode && (await barcodeJaExiste(casaId, barcode))) throw new Error("PRODUCT_BARCODE_EXISTS");

  const [criado] = await db
    .insert(products)
    .values({
      casaId: casaId,
      name,
      category: category || "Mercearia",
      barcode,
      photoUri: input.photoUri ?? null,
      // Estoque nasce vazio, então o status do produto acompanha (em falta) —
      // evita divergir do que o DTO/lista/snapshot mostram. (auditoria #7)
      status: "missing",
      alertThreshold: input.alertThreshold?.trim() || null,
      occasional: input.occasional ?? false,
    })
    .returning({ id: products.id });

  await db.insert(inventoryItems).values({
    productId: criado.id,
    quantity: "0 un",
    status: "missing",
  });

  const dto = await getProdutoDTO(casaId, criado.id);
  if (!dto) throw new Error("PRODUCT_NOT_FOUND_AFTER_INSERT");
  return dto;
}

export async function updateProduto(
  casaId: number,
  id: number,
  input: NewProductInput
): Promise<ProductDTO> {
  const name = input.name.trim();
  const category = input.category.trim();
  if (!name) throw new Error("PRODUCT_NAME_REQUIRED");
  validateProductFields(input);
  if (await nomeJaExiste(casaId, name, id)) throw new Error("PRODUCT_ALREADY_EXISTS");
  const barcode = input.barcode?.trim() || null;
  if (barcode && (await barcodeJaExiste(casaId, barcode, id))) throw new Error("PRODUCT_BARCODE_EXISTS");

  await db
    .update(products)
    .set({
      name,
      category: category || "Mercearia",
      barcode,
      photoUri: input.photoUri ?? null,
      alertThreshold: input.alertThreshold?.trim() || null,
      occasional: input.occasional ?? false,
      updatedAt: new Date(),
    })
    .where(and(eq(products.casaId, casaId), eq(products.id, id)));

  const dto = await getProdutoDTO(casaId, id);
  if (!dto) throw new Error("PRODUCT_NOT_FOUND");
  return dto;
}

// Remover um produto no web sempre ARQUIVA, nunca exclui: o Postgres é a cópia
// compartilhada da casa e o contrato de sync não tem tombstone de produto — uma
// exclusão física seria desfeita no próximo sync de qualquer device que ainda
// tenha o produto ("excluí e voltou sozinho"). Arquivado propaga via flag
// `archived` e preserva histórico/preços. (auditoria 2026-06-09 #3)
export async function excluirOuArquivarProduto(
  casaId: number,
  id: number
): Promise<{ arquivado: boolean }> {
  const [produto] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.casaId, casaId), eq(products.id, id)))
    .limit(1);
  if (!produto) throw new Error("PRODUCT_NOT_FOUND");

  await db
    .update(products)
    .set({ archived: true, updatedAt: new Date() })
    .where(and(eq(products.casaId, casaId), eq(products.id, id)));
  return { arquivado: true };
}

export async function desarquivarProduto(casaId: number, id: number): Promise<void> {
  await db
    .update(products)
    .set({ archived: false, updatedAt: new Date() })
    .where(and(eq(products.casaId, casaId), eq(products.id, id)));
}

