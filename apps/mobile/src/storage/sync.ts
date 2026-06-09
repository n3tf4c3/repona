import { eventKey, uuidv4, productNameKey, shouldApplyIncoming, type SyncSnapshot } from '@repona/core';
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

  // Itens da lista ativa, inclusive tombstones (deleted), para a deleção
  // propagar para os outros devices. (auditoria #9)
  const lista = await database.getFirstAsync<{ id: number }>(
    `SELECT id FROM shopping_lists WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`,
  );
  const itensLista = lista
    ? await database.getAllAsync<{
        product_name: string;
        quantity: string;
        checked: number;
        deleted: number;
        updated_at: string;
      }>(
        `SELECT p.name as product_name, sli.quantity, sli.checked, sli.deleted, sli.updated_at
         FROM shopping_list_items sli INNER JOIN products p ON p.id = sli.product_id
         WHERE sli.shopping_list_id = ?`,
        lista.id,
      )
    : [];

  return {
    products: produtos.map((p) => ({
      syncId: p.syncId,
      updatedAt: p.updatedAt,
      name: p.name,
      category: p.category,
      barcode: p.barcode,
      purchaseCount: p.purchaseCount,
      status: p.status,
      alertThreshold: p.alertThreshold,
      inventoryQuantity: p.inventoryQuantity,
      inventoryStatus: p.inventoryStatus,
      archived: p.archived,
      occasional: p.occasional,
    })),
    purchases: compras.map((c) => ({
      productName: c.productName,
      quantity: c.quantity,
      purchasedAt: c.purchasedAt,
      sourceListName: c.sourceListName,
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
    listItems: itensLista.map((i) => ({
      productName: i.product_name,
      quantity: i.quantity,
      checked: i.checked === 1,
      deleted: i.deleted === 1,
      updatedAt: i.updated_at,
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
      const nome = prod.name.trim();

      // Resolve identidade: syncId primeiro; senão por nome, adotando o syncId
      // do servidor; senão insere. (auditoria #1)
      let row = prod.syncId
        ? await database.getFirstAsync<{ id: number; name: string; updated_at: string }>(
            'SELECT id, name, updated_at FROM products WHERE sync_id = ? LIMIT 1',
            prod.syncId,
          )
        : null;

      if (!row && prod.barcode) {
        // Casa por código de barras (não-nulo) quando o syncId não bate e antes
        // do nome; adota o syncId do servidor. Sem código não entra aqui, então
        // hortifrúti segue só pelo nome. (auditoria #19)
        const porBarcode = await database.getFirstAsync<{ id: number; name: string; updated_at: string }>(
          'SELECT id, name, updated_at FROM products WHERE barcode = ? LIMIT 1',
          prod.barcode,
        );
        if (porBarcode && prod.syncId) {
          await database.runAsync('UPDATE products SET sync_id = ? WHERE id = ?', prod.syncId, porBarcode.id);
        }
        row = porBarcode;
      }

      if (!row) {
        const porNome = await database.getFirstAsync<{ id: number; name: string; updated_at: string }>(
          'SELECT id, name, updated_at FROM products WHERE lower(name) = lower(?) LIMIT 1',
          nome,
        );
        if (porNome && prod.syncId) {
          await database.runAsync('UPDATE products SET sync_id = ? WHERE id = ?', prod.syncId, porNome.id);
        }
        row = porNome;
      }

      let productId: number;

      if (row) {
        // LWW: registro mais antigo que o local não sobrescreve. (auditoria #2)
        if (!shouldApplyIncoming(prod.updatedAt, row.updated_at)) {
          continue;
        }
        // Renomeia só se o novo nome não pertence a outro produto local (evita
        // violar a unicidade); em colisão mantém o nome local e reconcilia depois.
        let nomeFinal = nome;
        if (productNameKey(prod.name) !== productNameKey(row.name)) {
          const colide = await database.getFirstAsync<{ id: number }>(
            'SELECT id FROM products WHERE lower(name) = lower(?) AND id <> ? LIMIT 1',
            nome,
            row.id,
          );
          if (colide) nomeFinal = row.name;
        }
        await database.runAsync(
          `UPDATE products SET
             name = ?, category = ?, barcode = ?,
             status = ?, alert_threshold = ?, archived = ?, occasional = ?, updated_at = ?
           WHERE id = ?`,
          nomeFinal,
          prod.category,
          prod.barcode,
          prod.status,
          prod.alertThreshold,
          prod.archived ? 1 : 0,
          prod.occasional ? 1 : 0,
          prod.updatedAt ?? now,
          row.id,
        );
        productId = row.id;
      } else {
        const inserido = await database.runAsync(
          `INSERT INTO products
             (sync_id, name, category, barcode, status, alert_threshold, archived, occasional, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          prod.syncId ?? uuidv4(),
          nome,
          prod.category,
          prod.barcode,
          prod.status,
          prod.alertThreshold,
          prod.archived ? 1 : 0,
          prod.occasional ? 1 : 0,
          now,
          prod.updatedAt ?? now,
        );
        productId = inserido.lastInsertRowId;
      }

      await database.runAsync(
        `INSERT INTO inventory_items (product_id, quantity, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(product_id) DO UPDATE SET
           quantity = excluded.quantity,
           status = excluded.status,
           updated_at = excluded.updated_at`,
        productId,
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
    await aplicarItensLista(database, idPorNome, snapshot.listItems ?? []);

    // purchase_count é derivado do histórico (auditoria #3): recalcula após o
    // merge, em vez de confiar no valor do snapshot (que não soma entre
    // dispositivos).
    await database.runAsync(
      `UPDATE products
       SET purchase_count = (
         SELECT COUNT(*) FROM purchase_history WHERE purchase_history.product_id = products.id
       )`,
    );
  });
}

type Db = Awaited<ReturnType<typeof initializeDatabase>>;

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function aplicarItensLista(
  database: Db,
  idPorNome: Map<string, number>,
  itens: NonNullable<SyncSnapshot['listItems']>,
) {
  if (itens.length === 0) return;

  let lista = await database.getFirstAsync<{ id: number }>(
    `SELECT id FROM shopping_lists WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`,
  );
  if (!lista) {
    const agora = new Date().toISOString();
    const res = await database.runAsync(
      `INSERT INTO shopping_lists (name, status, created_at, updated_at)
       VALUES ('Compra da Semana', 'active', ?, ?)`,
      agora,
      agora,
    );
    lista = { id: res.lastInsertRowId };
  }

  const existentes = await database.getAllAsync<{ product_id: number; updated_at: string }>(
    `SELECT product_id, updated_at FROM shopping_list_items WHERE shopping_list_id = ?`,
    lista.id,
  );
  const porProduto = new Map(existentes.map((e) => [e.product_id, e.updated_at]));

  for (const item of itens) {
    const productId = idPorNome.get(item.productName.trim().toLocaleLowerCase('pt-BR'));
    if (!productId) continue;
    const atual = porProduto.get(productId);
    const updatedAt = item.updatedAt ?? new Date().toISOString();

    if (atual !== undefined) {
      // LWW: só aplica o recebido se for mais novo que o local. (auditoria #9)
      if (!shouldApplyIncoming(item.updatedAt, atual)) continue;
      await database.runAsync(
        `UPDATE shopping_list_items SET quantity = ?, checked = ?, deleted = ?, updated_at = ?
         WHERE shopping_list_id = ? AND product_id = ?`,
        item.quantity,
        item.checked ? 1 : 0,
        item.deleted ? 1 : 0,
        updatedAt,
        lista.id,
        productId,
      );
    } else {
      await database.runAsync(
        `INSERT INTO shopping_list_items
           (shopping_list_id, product_id, quantity, checked, deleted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        lista.id,
        productId,
        item.quantity,
        item.checked ? 1 : 0,
        item.deleted ? 1 : 0,
        updatedAt,
        updatedAt,
      );
      porProduto.set(productId, updatedAt);
    }
  }

  // Poda tombstones já propagados (mais velhos que o TTL). (auditoria #9)
  const limite = new Date(Date.now() - TOMBSTONE_TTL_MS).toISOString();
  await database.runAsync(
    `DELETE FROM shopping_list_items WHERE shopping_list_id = ? AND deleted = 1 AND updated_at < ?`,
    lista.id,
    limite,
  );
}

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
      `INSERT INTO purchase_history (product_id, quantity, purchased_at, source_list_id, source_list_name)
       VALUES (?, ?, ?, NULL, ?)`,
      productId,
      compra.quantity,
      compra.purchasedAt,
      compra.sourceListName ?? null,
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
