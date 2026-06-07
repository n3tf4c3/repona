import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import {
  products,
  inventoryItems,
  inventoryEvents,
  purchaseHistory,
  priceHistory,
} from "@/server/db/schema";
import { productNameKey, type SyncSnapshot } from "@repona/core";

const MAX_PRICES_PER_PRODUCT = 10;

// Merge do snapshot do mobile na casa, devolvendo o snapshot mesclado.
// Regras: produto casa por nome (o celular vence nos campos); compras e consumos
// são append-only com dedupe por produto+instante+quantidade. Nada é apagado.
export async function mergeCasaSnapshot(
  casaId: number,
  incoming: SyncSnapshot
): Promise<SyncSnapshot> {
  const existentes = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.casaId, casaId));
  const idPorNome = new Map(existentes.map((p) => [productNameKey(p.name), p.id]));

  for (const prod of incoming.products) {
    const chave = productNameKey(prod.name);
    let productId = idPorNome.get(chave);

    if (productId) {
      await db
        .update(products)
        .set({
          category: prod.category,
          barcode: prod.barcode,
          photoUri: prod.photoUri,
          purchaseCount: prod.purchaseCount,
          status: prod.status,
          alertThreshold: prod.alertThreshold,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId));
    } else {
      const [novo] = await db
        .insert(products)
        .values({
          casaId,
          name: prod.name.trim(),
          category: prod.category,
          barcode: prod.barcode,
          photoUri: prod.photoUri,
          purchaseCount: prod.purchaseCount,
          status: prod.status,
          alertThreshold: prod.alertThreshold,
        })
        .returning({ id: products.id });
      productId = novo.id;
      idPorNome.set(chave, productId);
    }

    await db
      .insert(inventoryItems)
      .values({ productId, quantity: prod.inventoryQuantity, status: prod.inventoryStatus })
      .onConflictDoUpdate({
        target: inventoryItems.productId,
        set: { quantity: prod.inventoryQuantity, status: prod.inventoryStatus, updatedAt: new Date() },
      });
  }

  await mesclarCompras(casaId, idPorNome, incoming.purchases);
  await mesclarConsumos(casaId, idPorNome, incoming.consumptions);
  await mesclarPrecos(casaId, idPorNome, incoming.prices);

  return construirSnapshot(casaId);
}

async function mesclarPrecos(
  casaId: number,
  idPorNome: Map<string, number>,
  incoming: SyncSnapshot["prices"]
) {
  const existentes = await db
    .select({
      productId: priceHistory.productId,
      priceCents: priceHistory.priceCents,
      recordedAt: priceHistory.recordedAt,
    })
    .from(priceHistory)
    .innerJoin(products, eq(products.id, priceHistory.productId))
    .where(eq(products.casaId, casaId));
  const vistos = new Set(
    existentes.map((e) => `${e.productId}|${e.recordedAt.toISOString()}|${e.priceCents}`)
  );

  for (const preco of incoming) {
    const productId = idPorNome.get(productNameKey(preco.productName));
    if (!productId) continue;
    const at = new Date(preco.recordedAt);
    if (Number.isNaN(at.getTime())) continue;
    const chave = `${productId}|${at.toISOString()}|${preco.priceCents}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    await db
      .insert(priceHistory)
      .values({ productId, priceCents: Math.round(preco.priceCents), recordedAt: at });
  }
}

async function mesclarCompras(
  casaId: number,
  idPorNome: Map<string, number>,
  incoming: SyncSnapshot["purchases"]
) {
  const existentes = await db
    .select({
      productId: purchaseHistory.productId,
      quantity: purchaseHistory.quantity,
      purchasedAt: purchaseHistory.purchasedAt,
    })
    .from(purchaseHistory)
    .innerJoin(products, eq(products.id, purchaseHistory.productId))
    .where(eq(products.casaId, casaId));
  const vistos = new Set(
    existentes.map((e) => `${e.productId}|${e.purchasedAt.toISOString()}|${e.quantity}`)
  );

  for (const compra of incoming) {
    const productId = idPorNome.get(productNameKey(compra.productName));
    if (!productId) continue;
    const at = new Date(compra.purchasedAt);
    if (Number.isNaN(at.getTime())) continue;
    const chave = `${productId}|${at.toISOString()}|${compra.quantity}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    await db
      .insert(purchaseHistory)
      .values({ productId, quantity: compra.quantity, purchasedAt: at });
  }
}

async function mesclarConsumos(
  casaId: number,
  idPorNome: Map<string, number>,
  incoming: SyncSnapshot["consumptions"]
) {
  const existentes = await db
    .select({
      productId: inventoryEvents.productId,
      quantity: inventoryEvents.quantity,
      occurredAt: inventoryEvents.occurredAt,
    })
    .from(inventoryEvents)
    .innerJoin(products, eq(products.id, inventoryEvents.productId))
    .where(eq(products.casaId, casaId));
  const vistos = new Set(
    existentes.map((e) => `${e.productId}|${e.occurredAt.toISOString()}|${e.quantity}`)
  );

  for (const consumo of incoming) {
    const productId = idPorNome.get(productNameKey(consumo.productName));
    if (!productId) continue;
    const at = new Date(consumo.occurredAt);
    if (Number.isNaN(at.getTime())) continue;
    const chave = `${productId}|${at.toISOString()}|${consumo.quantity}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    await db
      .insert(inventoryEvents)
      .values({ productId, eventType: "consumed", quantity: consumo.quantity, occurredAt: at });
  }
}

async function construirSnapshot(casaId: number): Promise<SyncSnapshot> {
  const linhasProdutos = await db
    .select({
      name: products.name,
      category: products.category,
      barcode: products.barcode,
      photoUri: products.photoUri,
      purchaseCount: products.purchaseCount,
      status: products.status,
      alertThreshold: products.alertThreshold,
      inventoryQuantity: inventoryItems.quantity,
      inventoryStatus: inventoryItems.status,
    })
    .from(products)
    .leftJoin(inventoryItems, eq(inventoryItems.productId, products.id))
    .where(eq(products.casaId, casaId));

  const linhasCompras = await db
    .select({
      productName: products.name,
      quantity: purchaseHistory.quantity,
      purchasedAt: purchaseHistory.purchasedAt,
    })
    .from(purchaseHistory)
    .innerJoin(products, eq(products.id, purchaseHistory.productId))
    .where(eq(products.casaId, casaId));

  const linhasConsumos = await db
    .select({
      productName: products.name,
      quantity: inventoryEvents.quantity,
      occurredAt: inventoryEvents.occurredAt,
    })
    .from(inventoryEvents)
    .innerJoin(products, eq(products.id, inventoryEvents.productId))
    .where(eq(products.casaId, casaId));

  const linhasPrecos = await db
    .select({
      productName: products.name,
      priceCents: priceHistory.priceCents,
      recordedAt: priceHistory.recordedAt,
    })
    .from(priceHistory)
    .innerJoin(products, eq(products.id, priceHistory.productId))
    .where(eq(products.casaId, casaId))
    .orderBy(desc(priceHistory.recordedAt));

  // Mantém só os 10 preços mais recentes por produto no snapshot devolvido.
  const precosPorProduto = new Map<string, SyncSnapshot["prices"]>();
  for (const p of linhasPrecos) {
    const lista = precosPorProduto.get(p.productName) ?? [];
    if (lista.length < MAX_PRICES_PER_PRODUCT) {
      lista.push({
        productName: p.productName,
        priceCents: p.priceCents,
        recordedAt: p.recordedAt.toISOString(),
      });
      precosPorProduto.set(p.productName, lista);
    }
  }

  return {
    products: linhasProdutos.map((p) => ({
      name: p.name,
      category: p.category,
      barcode: p.barcode,
      photoUri: p.photoUri,
      purchaseCount: p.purchaseCount,
      status: p.status as SyncSnapshot["products"][number]["status"],
      alertThreshold: p.alertThreshold,
      inventoryQuantity: p.inventoryQuantity ?? "0 un",
      inventoryStatus: (p.inventoryStatus ??
        "missing") as SyncSnapshot["products"][number]["inventoryStatus"],
    })),
    purchases: linhasCompras.map((c) => ({
      productName: c.productName,
      quantity: c.quantity,
      purchasedAt: c.purchasedAt.toISOString(),
    })),
    consumptions: linhasConsumos.map((c) => ({
      productName: c.productName,
      quantity: c.quantity,
      occurredAt: c.occurredAt.toISOString(),
    })),
    prices: [...precosPorProduto.values()].flat(),
  };
}
