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
import { productNameKey, matchProduct, shouldApplyIncoming, type SyncSnapshot } from "@repona/core";

const MAX_PRICES_PER_PRODUCT = 10;

// Instante em segundos de epoch: o dedupe normaliza o timestamp para tolerar
// diferenças de fração de segundo/formato no ida-e-volta entre mobile e nuvem
// (mesma lógica do eventKey do core). A quantidade é comparada com trim().
function instanteEmSegundos(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

// Merge do snapshot do mobile na casa, devolvendo o snapshot mesclado.
// Regras: produto casa por nome (o celular vence nos campos); compras e consumos
// são append-only com dedupe por produto+instante+quantidade. Nada é apagado.
export async function mergeCasaSnapshot(
  casaId: number,
  incoming: SyncSnapshot
): Promise<SyncSnapshot> {
  const existentes = await db
    .select({
      id: products.id,
      name: products.name,
      syncId: products.syncId,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(eq(products.casaId, casaId));
  const idPorNome = new Map(existentes.map((p) => [productNameKey(p.name), p.id]));
  const idPorSyncId = new Map(existentes.map((p) => [p.syncId, p.id]));
  const infoPorId = new Map(existentes.map((p) => [p.id, { name: p.name, updatedAt: p.updatedAt }]));

  for (const prod of incoming.products) {
    // Casa por syncId, cai para o nome (legado). Em match, o syncId do servidor
    // é autoritativo: não sobrescrevemos products.syncId. (auditoria #1)
    const match = matchProduct(prod, { idBySyncId: idPorSyncId, idByName: idPorNome });
    let productId: number;

    if (match.id !== null) {
      const info = infoPorId.get(match.id)!;
      // LWW: registro mais antigo que o local não sobrescreve. (auditoria #2)
      if (!shouldApplyIncoming(prod.updatedAt, info.updatedAt.toISOString())) {
        continue;
      }
      // Renomeia só se o novo nome não pertence a outro produto (evita violar a
      // unicidade); em colisão mantém o nome local e reconcilia depois.
      const donoDoNome = idPorNome.get(productNameKey(prod.name));
      const nomeColide = donoDoNome !== undefined && donoDoNome !== match.id;
      const nomeFinal = nomeColide ? info.name : prod.name.trim();
      const novoUpdatedAt = prod.updatedAt ? new Date(prod.updatedAt) : new Date();

      await db
        .update(products)
        .set({
          name: nomeFinal,
          category: prod.category,
          barcode: prod.barcode,
          photoUri: prod.photoUri,
          purchaseCount: prod.purchaseCount,
          status: prod.status,
          alertThreshold: prod.alertThreshold,
          archived: prod.archived,
          occasional: prod.occasional,
          updatedAt: novoUpdatedAt,
        })
        .where(eq(products.id, match.id));

      if (productNameKey(info.name) !== productNameKey(nomeFinal)) {
        idPorNome.delete(productNameKey(info.name));
        idPorNome.set(productNameKey(nomeFinal), match.id);
      }
      infoPorId.set(match.id, { name: nomeFinal, updatedAt: novoUpdatedAt });
      productId = match.id;
    } else {
      const [novo] = await db
        .insert(products)
        .values({
          casaId,
          syncId: prod.syncId,
          name: prod.name.trim(),
          category: prod.category,
          barcode: prod.barcode,
          photoUri: prod.photoUri,
          purchaseCount: prod.purchaseCount,
          status: prod.status,
          alertThreshold: prod.alertThreshold,
          archived: prod.archived,
          occasional: prod.occasional,
          updatedAt: prod.updatedAt ? new Date(prod.updatedAt) : undefined,
        })
        .returning({ id: products.id, syncId: products.syncId });
      productId = novo.id;
      idPorNome.set(productNameKey(prod.name), productId);
      idPorSyncId.set(novo.syncId, productId);
      infoPorId.set(productId, {
        name: prod.name.trim(),
        updatedAt: prod.updatedAt ? new Date(prod.updatedAt) : new Date(),
      });
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
    existentes.map((e) => `${e.productId}|${instanteEmSegundos(e.recordedAt)}|${e.priceCents}`)
  );

  for (const preco of incoming) {
    const productId = idPorNome.get(productNameKey(preco.productName));
    if (!productId) continue;
    const at = new Date(preco.recordedAt);
    if (Number.isNaN(at.getTime())) continue;
    const chave = `${productId}|${instanteEmSegundos(at)}|${Math.round(preco.priceCents)}`;
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
    existentes.map((e) => `${e.productId}|${instanteEmSegundos(e.purchasedAt)}|${e.quantity.trim()}`)
  );

  for (const compra of incoming) {
    const productId = idPorNome.get(productNameKey(compra.productName));
    if (!productId) continue;
    const at = new Date(compra.purchasedAt);
    if (Number.isNaN(at.getTime())) continue;
    const chave = `${productId}|${instanteEmSegundos(at)}|${compra.quantity.trim()}`;
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
    existentes.map((e) => `${e.productId}|${instanteEmSegundos(e.occurredAt)}|${e.quantity.trim()}`)
  );

  for (const consumo of incoming) {
    const productId = idPorNome.get(productNameKey(consumo.productName));
    if (!productId) continue;
    const at = new Date(consumo.occurredAt);
    if (Number.isNaN(at.getTime())) continue;
    const chave = `${productId}|${instanteEmSegundos(at)}|${consumo.quantity.trim()}`;
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
      syncId: products.syncId,
      updatedAt: products.updatedAt,
      name: products.name,
      category: products.category,
      barcode: products.barcode,
      photoUri: products.photoUri,
      purchaseCount: products.purchaseCount,
      status: products.status,
      alertThreshold: products.alertThreshold,
      archived: products.archived,
      occasional: products.occasional,
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
      syncId: p.syncId,
      updatedAt: p.updatedAt.toISOString(),
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
      archived: p.archived,
      occasional: p.occasional,
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
