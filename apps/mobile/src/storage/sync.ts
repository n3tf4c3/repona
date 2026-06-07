import { eventKey, type SyncSnapshot } from '@repona/core';
import { initializeDatabase } from './database';
import { listAllProductsForSync } from './products';
import { listPurchaseHistoryRecords } from './purchaseHistory';

// Monta o snapshot local (produtos + estoque, compras e consumos). A lista de
// compras é transitória e fica de fora — só dados duráveis vão pra nuvem.
export async function buildLocalSnapshot(): Promise<SyncSnapshot> {
  const database = await initializeDatabase();

  const produtos = await listAllProductsForSync();
  const compras = await listPurchaseHistoryRecords();
  const consumos = await database.getAllAsync<{
    product_name: string;
    quantity: string;
    occurred_at: string;
  }>(`
    SELECT p.name as product_name, ie.quantity, ie.occurred_at
    FROM inventory_events ie
    INNER JOIN products p ON p.id = ie.product_id
    WHERE ie.event_type = 'consumed'
  `);
  const precos = await database.getAllAsync<{
    product_name: string;
    price_cents: number;
    recorded_at: string;
  }>(`
    SELECT p.name as product_name, ph.price_cents, ph.recorded_at
    FROM price_history ph
    INNER JOIN products p ON p.id = ph.product_id
  `);

  return {
    products: produtos.map((p) => ({
      name: p.name,
      category: p.category,
      barcode: p.barcode,
      photoUri: p.photoUri,
      purchaseCount: p.purchaseCount,
      status: p.status,
      alertThreshold: p.alertThreshold,
      inventoryQuantity: p.inventoryQuantity,
      inventoryStatus: p.inventoryStatus,
      archived: p.archived,
    })),
    purchases: compras.map((c) => ({
      productName: c.productName,
      quantity: c.quantity,
      purchasedAt: c.purchasedAt,
    })),
    consumptions: consumos.map((c) => ({
      productName: c.product_name,
      quantity: c.quantity,
      occurredAt: c.occurred_at,
    })),
    prices: precos.map((p) => ({
      productName: p.product_name,
      priceCents: p.price_cents,
      recordedAt: p.recorded_at,
    })),
  };
}

// Aplica o snapshot mesclado vindo da nuvem no SQLite local. Nunca apaga:
// produtos são upsert por nome, compras e consumos entram só se ainda não
// existirem (dedupe por produto+instante+quantidade).
export async function applySnapshot(snapshot: SyncSnapshot): Promise<void> {
  const database = await initializeDatabase();
  const now = new Date().toISOString();

  await database.withTransactionAsync(async () => {
    for (const prod of snapshot.products) {
      await database.runAsync(
        `INSERT INTO products
           (name, category, barcode, photo_uri, purchase_count, status, alert_threshold, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           category = excluded.category,
           barcode = excluded.barcode,
           photo_uri = excluded.photo_uri,
           purchase_count = excluded.purchase_count,
           status = excluded.status,
           alert_threshold = excluded.alert_threshold,
           archived = excluded.archived,
           updated_at = excluded.updated_at`,
        prod.name.trim(),
        prod.category,
        prod.barcode,
        prod.photoUri,
        prod.purchaseCount,
        prod.status,
        prod.alertThreshold,
        prod.archived ? 1 : 0,
        now,
        now,
      );

      const row = await database.getFirstAsync<{ id: number }>(
        'SELECT id FROM products WHERE lower(name) = lower(?) LIMIT 1',
        prod.name.trim(),
      );
      if (!row) continue;

      await database.runAsync(
        `INSERT INTO inventory_items (product_id, quantity, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(product_id) DO UPDATE SET
           quantity = excluded.quantity,
           status = excluded.status,
           updated_at = excluded.updated_at`,
        row.id,
        prod.inventoryQuantity,
        prod.inventoryStatus,
        now,
        now,
      );
    }

    const idPorNome = new Map<string, number>();
    const todos = await database.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM products');
    for (const p of todos) idPorNome.set(p.name.trim().toLocaleLowerCase('pt-BR'), p.id);

    await aplicarCompras(database, idPorNome, snapshot.purchases);
    await aplicarConsumos(database, idPorNome, snapshot.consumptions);
    await aplicarPrecos(database, idPorNome, snapshot.prices);
  });
}

type Db = Awaited<ReturnType<typeof initializeDatabase>>;

async function aplicarCompras(database: Db, idPorNome: Map<string, number>, compras: SyncSnapshot['purchases']) {
  const existentes = await database.getAllAsync<{ name: string; quantity: string; purchased_at: string }>(`
    SELECT p.name, ph.quantity, ph.purchased_at
    FROM purchase_history ph INNER JOIN products p ON p.id = ph.product_id
  `);
  const vistos = new Set(existentes.map((e) => eventKey(e.name, e.purchased_at, e.quantity)));

  for (const compra of compras) {
    const productId = idPorNome.get(compra.productName.trim().toLocaleLowerCase('pt-BR'));
    if (!productId) continue;
    const chave = eventKey(compra.productName, compra.purchasedAt, compra.quantity);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    await database.runAsync(
      `INSERT INTO purchase_history (product_id, quantity, purchased_at, source_list_id)
       VALUES (?, ?, ?, NULL)`,
      productId,
      compra.quantity,
      compra.purchasedAt,
    );
  }
}

async function aplicarPrecos(database: Db, idPorNome: Map<string, number>, precos: SyncSnapshot['prices']) {
  const existentes = await database.getAllAsync<{ name: string; price_cents: number; recorded_at: string }>(`
    SELECT p.name, ph.price_cents, ph.recorded_at
    FROM price_history ph INNER JOIN products p ON p.id = ph.product_id
  `);
  const vistos = new Set(existentes.map((e) => eventKey(e.name, e.recorded_at, String(e.price_cents))));
  const tocados = new Set<number>();

  for (const preco of precos) {
    const productId = idPorNome.get(preco.productName.trim().toLocaleLowerCase('pt-BR'));
    if (!productId) continue;
    const chave = eventKey(preco.productName, preco.recordedAt, String(preco.priceCents));
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    await database.runAsync(
      `INSERT INTO price_history (product_id, price_cents, recorded_at) VALUES (?, ?, ?)`,
      productId,
      Math.round(preco.priceCents),
      preco.recordedAt,
    );
    tocados.add(productId);
  }

  // Mantém apenas os 10 preços mais recentes por produto tocado.
  for (const productId of tocados) {
    await database.runAsync(
      `DELETE FROM price_history
       WHERE product_id = ?
         AND id NOT IN (
           SELECT id FROM price_history
           WHERE product_id = ?
           ORDER BY recorded_at DESC, id DESC
           LIMIT 10
         )`,
      productId,
      productId,
    );
  }
}

async function aplicarConsumos(database: Db, idPorNome: Map<string, number>, consumos: SyncSnapshot['consumptions']) {
  const existentes = await database.getAllAsync<{ name: string; quantity: string; occurred_at: string }>(`
    SELECT p.name, ie.quantity, ie.occurred_at
    FROM inventory_events ie INNER JOIN products p ON p.id = ie.product_id
    WHERE ie.event_type = 'consumed'
  `);
  const vistos = new Set(existentes.map((e) => eventKey(e.name, e.occurred_at, e.quantity)));

  for (const consumo of consumos) {
    const productId = idPorNome.get(consumo.productName.trim().toLocaleLowerCase('pt-BR'));
    if (!productId) continue;
    const chave = eventKey(consumo.productName, consumo.occurredAt, consumo.quantity);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    await database.runAsync(
      `INSERT INTO inventory_events (product_id, event_type, quantity, occurred_at)
       VALUES (?, 'consumed', ?, ?)`,
      productId,
      consumo.quantity,
      consumo.occurredAt,
    );
  }
}
