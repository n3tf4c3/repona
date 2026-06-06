import "server-only";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { ProductDTO, NewProductInput, ProductStatus, InventoryStatus } from "@repona/core";
import { db } from "@/server/db";
import { products, inventoryItems, inventoryEvents, purchaseHistory } from "@/server/db/schema";

// Catálogo inicial (mesmo do mobile: apps/mobile/src/storage/products.ts).
const seedProducts: Array<{
  name: string;
  category: string;
  purchaseCount: number;
  status?: ProductStatus;
}> = [
  { name: "Leite integral", category: "Laticínios", purchaseCount: 12 },
  { name: "Maçã Fuji", category: "Hortifrúti", purchaseCount: 9 },
  { name: "Café torrado", category: "Bebidas", purchaseCount: 7, status: "missing" },
  { name: "Ovos brancos", category: "Hortifrúti", purchaseCount: 11 },
  { name: "Cenoura", category: "Hortifrúti", purchaseCount: 6 },
  { name: "Biscoito", category: "Mercearia", purchaseCount: 5 },
];

// Subconsulta de consumo agregado (eventos 'consumed') por produto.
function consumoSubquery() {
  return db
    .select({
      productId: inventoryEvents.productId,
      consumptionCount: sql<number>`count(*)`.as("consumption_count"),
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
  createdAt: Date;
  updatedAt: Date;
};

function selecionarProdutos(casaId: number, id?: number) {
  const consumo = consumoSubquery();
  const filtro =
    id === undefined
      ? eq(products.casaId, casaId)
      : and(eq(products.casaId, casaId), eq(products.id, id));
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
      inventoryStatus: sql<string>`coalesce(${inventoryItems.status}, case ${products.status} when 'missing' then 'missing' else 'in_stock' end)`,
      consumptionCount: sql<number>`coalesce(${consumo.consumptionCount}, 0)`,
      lastConsumedAt: consumo.lastConsumedAt,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .leftJoin(inventoryItems, eq(inventoryItems.productId, products.id))
    .leftJoin(consumo, eq(consumo.productId, products.id))
    .where(filtro);
}

function mapProduto(row: ProdutoRow): ProductDTO {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    barcode: row.barcode,
    photoUri: row.photoUri,
    purchaseCount: row.purchaseCount,
    status: row.status as ProductStatus,
    alertThreshold: row.alertThreshold,
    inventoryQuantity: row.inventoryQuantity,
    inventoryStatus: row.inventoryStatus as InventoryStatus,
    consumptionCount: row.consumptionCount,
    lastConsumedAt: row.lastConsumedAt ? row.lastConsumedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProdutos(casaId: number): Promise<ProductDTO[]> {
  const rows = await selecionarProdutos(casaId).orderBy(desc(products.createdAt), asc(products.name));
  return rows.map(mapProduto);
}

async function getProdutoDTO(casaId: number, id: number): Promise<ProductDTO | null> {
  const [row] = await selecionarProdutos(casaId, id);
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

export async function createProduto(casaId: number, input: NewProductInput): Promise<ProductDTO> {
  const name = input.name.trim();
  const category = input.category.trim();
  if (!name) throw new Error("PRODUCT_NAME_REQUIRED");
  if (await nomeJaExiste(casaId, name)) throw new Error("PRODUCT_ALREADY_EXISTS");

  const [criado] = await db
    .insert(products)
    .values({
      casaId: casaId,
      name,
      category: category || "Mercearia",
      barcode: input.barcode ?? null,
      photoUri: input.photoUri ?? null,
      alertThreshold: input.alertThreshold?.trim() || null,
    })
    .returning({ id: products.id });

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
  if (await nomeJaExiste(casaId, name, id)) throw new Error("PRODUCT_ALREADY_EXISTS");

  await db
    .update(products)
    .set({
      name,
      category: category || "Mercearia",
      barcode: input.barcode ?? null,
      photoUri: input.photoUri ?? null,
      alertThreshold: input.alertThreshold?.trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(products.casaId, casaId), eq(products.id, id)));

  const dto = await getProdutoDTO(casaId, id);
  if (!dto) throw new Error("PRODUCT_NOT_FOUND");
  return dto;
}

export async function deleteProduto(casaId: number, id: number): Promise<void> {
  // Confirma posse e existência.
  const [produto] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.casaId, casaId), eq(products.id, id)))
    .limit(1);
  if (!produto) throw new Error("PRODUCT_NOT_FOUND");

  const [historico] = await db
    .select({ count: sql<number>`count(*)` })
    .from(purchaseHistory)
    .where(eq(purchaseHistory.productId, id));
  if (Number(historico?.count ?? 0) > 0) throw new Error("PRODUCT_HAS_HISTORY");

  // FKs com ON DELETE CASCADE removem inventory_items/events e itens de lista.
  await db.delete(products).where(and(eq(products.casaId, casaId), eq(products.id, id)));
}

export async function seedProdutosIniciais(casaId: number): Promise<void> {
  const [contagem] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(eq(products.casaId, casaId));
  if (Number(contagem?.count ?? 0) > 0) return;

  for (const produto of seedProducts) {
    const status = produto.status ?? "active";
    const [criado] = await db
      .insert(products)
      .values({
        casaId: casaId,
        name: produto.name,
        category: produto.category,
        purchaseCount: produto.purchaseCount,
        status,
      })
      .returning({ id: products.id });

    await db.insert(inventoryItems).values({
      productId: criado.id,
      quantity: status === "missing" ? "0 un" : "1 un",
      status: status === "missing" ? "missing" : "in_stock",
    });
  }
}
