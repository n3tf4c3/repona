import {
  deriveInventoryQuantity,
  eventKey,
  isEmptyQuantity,
  productNameKey,
  sameSyncEvent,
  shouldApplyIncoming,
  shouldApplyIncomingDeleted,
  uuidv4,
  MAX_PRICE_CENTS,
  type SyncSnapshot,
} from '@repona/core';
import { initializeDatabase } from './database';
import { listAllProductsForSync } from './products';

export { parseSyncSnapshot } from './syncSnapshot';

// Compras/consumos mais antigos que isto ficam fora do snapshot enviado. O
// histórico local e o da nuvem permanecem completos (o merge nunca apaga e o
// dedupe ignora o que não viaja); a janela só impede que o acúmulo append-only
// estoure o limite de itens do endpoint (10k) e quebre o sync inteiro.
// (auditoria 2026-06-09 #7)
const EVENT_WINDOW_MS = 24 * 30 * 24 * 60 * 60 * 1000; // ~24 meses

function dentroDaJanela(isoDate: string, cutoffMs: number): boolean {
  const ms = new Date(isoDate).getTime();
  return Number.isNaN(ms) || ms >= cutoffMs;
}

// Monta o snapshot local (produtos + estoque, compras e consumos). A lista de
// compras é transitória e fica de fora — só dados duráveis vão pra nuvem.
export async function buildLocalSnapshot(): Promise<SyncSnapshot> {
  const database = await initializeDatabase();
  // Na primeira sincronização (nunca sincronizou) manda o histórico inteiro, sem
  // a janela: senão, um aparelho usado offline por muito tempo antes de parear
  // teria eventos antigos que nunca chegaram à nuvem descartados de vez. Depois
  // do primeiro sync a janela vale de novo — o que ficou de fora já subiu antes.
  // (auditoria #56)
  const jaSincronizou = await database.getFirstAsync<{ value: string }>(
    `SELECT value FROM settings WHERE key = 'last_sync_at' LIMIT 1`,
  );
  const cutoffMs = jaSincronizou ? Date.now() - EVENT_WINDOW_MS : 0;

  const produtos = await listAllProductsForSync();
  // Consulta direta (não listPurchaseHistoryRecords, que filtra deleted): os
  // tombstones de compra viajam no snapshot para a exclusão propagar.
  const comprasTodas = await database.getAllAsync<{
    sync_id: string | null;
    product_name: string;
    quantity: string;
    purchased_at: string;
    source_list_name: string | null;
    deleted: number;
    updated_at: string | null;
  }>(`
    SELECT ph.sync_id, p.name as product_name, ph.quantity, ph.purchased_at,
           COALESCE(ph.source_list_name, sl.name) as source_list_name,
           ph.deleted, ph.updated_at
    FROM purchase_history ph
    INNER JOIN products p ON p.id = ph.product_id
    LEFT JOIN shopping_lists sl ON sl.id = ph.source_list_id
  `);
  // Tombstones ignoram a janela: ela filtra pelo instante da COMPRA, e a
  // exclusão de uma compra antiga precisa propagar mesmo assim. São raros
  // (só a edição manual do histórico os cria), então não pesam no cap do
  // endpoint. (auditoria #66)
  const compras = comprasTodas.filter(
    (c) => c.deleted === 1 || dentroDaJanela(c.purchased_at, cutoffMs),
  );
  const consumosTodos = await database.getAllAsync<{
    sync_id: string | null;
    event_type: 'consumed' | 'set';
    product_name: string;
    quantity: string;
    occurred_at: string;
  }>(`
    SELECT ie.sync_id, ie.event_type, p.name as product_name, ie.quantity, ie.occurred_at
    FROM inventory_events ie
    INNER JOIN products p ON p.id = ie.product_id
  `);
  // Eventos `set` sÃ£o baselines do saldo derivado e nunca podem cair pela
  // janela; os deltas continuam limitados depois da primeira sync. (#55/#72)
  const consumos = consumosTodos.filter(
    (c) => c.event_type === 'set' || dentroDaJanela(c.occurred_at, cutoffMs),
  );
  // Só preços dentro da faixa válida (1..MAX_PRICE_CENTS) e os 10 mais recentes
  // por produto. Dados legados/corrompidos (preço fora do teto, criados antes da
  // correção #29) travavam o sync inteiro com INVALID_BODY; e o histórico podia
  // estourar o limite do snapshot. (auditoria #41)
  const precos = await database.getAllAsync<{
    sync_id: string | null;
    product_name: string;
    price_cents: number;
    recorded_at: string;
  }>(
    `SELECT sync_id, product_name, price_cents, recorded_at FROM (
       SELECT ph.sync_id, p.name as product_name, ph.price_cents, ph.recorded_at,
              ROW_NUMBER() OVER (PARTITION BY ph.product_id ORDER BY ph.recorded_at DESC, ph.id DESC) AS rn
       FROM price_history ph INNER JOIN products p ON p.id = ph.product_id
       WHERE ph.price_cents BETWEEN 1 AND ?
     ) WHERE rn <= 10`,
    MAX_PRICE_CENTS,
  );

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
      metadataUpdatedAt: p.updatedAt,
      inventoryUpdatedAt: p.inventoryUpdatedAt ?? undefined,
      name: p.name,
      category: p.category,
      brand: p.brand,
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
      syncId: c.sync_id ?? undefined,
      productName: c.product_name,
      quantity: c.quantity,
      purchasedAt: c.purchased_at,
      sourceListName: c.source_list_name,
      deleted: c.deleted === 1,
      updatedAt: c.updated_at,
    })),
    consumptions: consumos.map((c) => ({
      syncId: c.sync_id ?? undefined,
      eventType: c.event_type,
      productName: c.product_name,
      quantity: c.quantity,
      occurredAt: c.occurred_at,
    })),
    prices: precos.map((p) => ({
      syncId: p.sync_id ?? undefined,
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
// O caller valida a resposta remota com parseSyncSnapshot antes de chegar aqui.
export async function applySnapshot(snapshot: SyncSnapshot): Promise<void> {
  const database = await initializeDatabase();
  const now = new Date().toISOString();

  type LocalProduct = {
    id: number;
    name: string;
    updated_at: string;
    inventory_updated_at: string | null;
  };
  const localProductSelect = `
    SELECT p.id, p.name, p.updated_at, ii.updated_at AS inventory_updated_at
    FROM products p
    LEFT JOIN inventory_items ii ON ii.product_id = p.id`;

  await database.withTransactionAsync(async () => {
    // Nome RECEBIDO → produto local resolvido (syncId/barcode/nome). Os eventos
    // do snapshot viajam com o nome do servidor, que pode não existir localmente
    // quando o LWW pula o produto ou um renomeio colide — resolver só pelo nome
    // local descartava o evento em silêncio ou o atribuía ao produto errado.
    // (auditoria 2026-06-09 #2)
    const idPorNomeRecebido = new Map<string, number>();

    for (const prod of snapshot.products) {
      const nome = prod.name.trim();

      // Resolve identidade: syncId primeiro; senão por nome, adotando o syncId
      // do servidor; senão insere. (auditoria #1)
      let row = prod.syncId
        ? await database.getFirstAsync<LocalProduct>(
            `${localProductSelect} WHERE p.sync_id = ? LIMIT 1`,
            prod.syncId,
          )
        : null;

      if (!row && prod.barcode?.trim()) {
        // Casa por código de barras (não-nulo) quando o syncId não bate e antes
        // do nome; adota o syncId do servidor. Sem código não entra aqui, então
        // hortifrúti segue só pelo nome. Comparação com trim dos dois lados —
        // código legado com espaço nunca casaria. (auditoria #19, 2026-06-09 #9)
        const porBarcode = await database.getFirstAsync<LocalProduct>(
          `${localProductSelect} WHERE trim(p.barcode) = ? LIMIT 1`,
          prod.barcode.trim(),
        );
        if (porBarcode && prod.syncId) {
          await database.runAsync('UPDATE products SET sync_id = ? WHERE id = ?', prod.syncId, porBarcode.id);
        }
        row = porBarcode;
      }

      if (!row) {
        const porNome = await database.getFirstAsync<LocalProduct>(
          `${localProductSelect} WHERE p.name_key = ? LIMIT 1`,
          productNameKey(nome), // Unicode-aware, alinhado ao web (auditoria #76)
        );
        if (porNome && prod.syncId) {
          await database.runAsync('UPDATE products SET sync_id = ? WHERE id = ?', prod.syncId, porNome.id);
        }
        row = porNome;
      }

      let productId: number;
      const metadataIncoming = prod.metadataUpdatedAt ?? prod.updatedAt;
      const inventoryIncoming = prod.inventoryUpdatedAt ?? prod.updatedAt;
      const metadataAt = metadataIncoming ?? now;
      const inventoryAt = inventoryIncoming ?? now;
      let aplicarEstoque = true;

      if (row) {
        // Mesmo sem aplicar o produto (LWW abaixo), os eventos do snapshot com
        // este nome referem-se a este produto local. (auditoria 2026-06-09 #2)
        idPorNomeRecebido.set(productNameKey(prod.name), row.id);
        // Metadados e estoque têm relógios independentes. Uma edição de nome
        // não pode bloquear o saldo mais novo de outro aparelho, nem vice-versa.
        // (#2)
        if (shouldApplyIncoming(metadataIncoming, row.updated_at)) {
          let nomeFinal = nome;
          if (productNameKey(prod.name) !== productNameKey(row.name)) {
            const colide = await database.getFirstAsync<{ id: number }>(
              'SELECT id FROM products WHERE name_key = ? AND id <> ? LIMIT 1',
              productNameKey(nome),
              row.id,
            );
            if (colide) nomeFinal = row.name;
          }

          let barcodeFinal = prod.barcode;
          if (prod.barcode?.trim()) {
            const colideBarcode = await database.getFirstAsync<{ barcode: string | null }>(
              'SELECT barcode FROM products WHERE trim(barcode) = ? AND id <> ? LIMIT 1',
              prod.barcode.trim(),
              row.id,
            );
            if (colideBarcode) {
              const atual = await database.getFirstAsync<{ barcode: string | null }>(
                'SELECT barcode FROM products WHERE id = ? LIMIT 1',
                row.id,
              );
              barcodeFinal = atual?.barcode ?? null;
            }
          }
          await database.runAsync(
            `UPDATE products SET
               name = ?, name_key = ?, category = ?, brand = ?, barcode = ?,
               alert_threshold = ?, archived = ?, occasional = ?, updated_at = ?
             WHERE id = ?`,
            nomeFinal,
            productNameKey(nomeFinal),
            prod.category,
            prod.brand ?? null,
            barcodeFinal,
            prod.alertThreshold,
            prod.archived ? 1 : 0,
            prod.occasional ? 1 : 0,
            metadataAt,
            row.id,
          );
        }
        aplicarEstoque =
          row.inventory_updated_at === null ||
          shouldApplyIncoming(inventoryIncoming, row.inventory_updated_at);
        productId = row.id;
      } else {
        const inserido = await database.runAsync(
          `INSERT INTO products
             (sync_id, name, name_key, category, brand, barcode, status, alert_threshold, archived, occasional, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          prod.syncId ?? uuidv4(),
          nome,
          productNameKey(nome), // Unicode-aware (auditoria #76)
          prod.category,
          prod.brand ?? null,
          prod.barcode,
          prod.status,
          prod.alertThreshold,
          prod.archived ? 1 : 0,
          prod.occasional ? 1 : 0,
          now,
          metadataAt,
        );
        productId = inserido.lastInsertRowId;
        idPorNomeRecebido.set(productNameKey(prod.name), productId);
      }

      if (aplicarEstoque) {
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
          inventoryAt,
        );
        await database.runAsync(
          'UPDATE products SET status = ? WHERE id = ?',
          prod.inventoryStatus === 'missing' ? 'missing' : 'active',
          productId,
        );
      }
    }

    const idPorNome = new Map<string, number>();
    const todos = await database.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM products');
    for (const p of todos) idPorNome.set(productNameKey(p.name), p.id);

    // O mapeamento dos nomes recebidos (resolvido produto a produto acima) tem
    // precedência sobre os nomes locais atuais. (auditoria 2026-06-09 #2)
    const idParaEventos = new Map([...idPorNome, ...idPorNomeRecebido]);

    await aplicarCompras(database, idParaEventos, snapshot.purchases);
    await aplicarConsumos(database, idParaEventos, snapshot.consumptions);
    await aplicarPrecos(database, idParaEventos, snapshot.prices);
    await aplicarItensLista(database, idParaEventos, snapshot.listItems ?? []);

    // purchase_count é derivado do histórico (auditoria #3): recalcula após o
    // merge, em vez de confiar no valor do snapshot (que não soma entre
    // dispositivos).
    await database.runAsync(
      `UPDATE products
       SET purchase_count = (
         SELECT COUNT(*) FROM purchase_history
         WHERE purchase_history.product_id = products.id AND purchase_history.deleted = 0
       )`,
    );
  });
}

type Db = Awaited<ReturnType<typeof initializeDatabase>>;

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type IndexedLocalEvent = {
  sync_id: string | null;
  legacyKey: string;
};

function indexLocalEvent<T extends IndexedLocalEvent>(
  event: T,
  bySyncId: Map<string, T>,
  byLegacyKey: Map<string, T[]>,
): void {
  if (event.sync_id) bySyncId.set(event.sync_id, event);
  const list = byLegacyKey.get(event.legacyKey) ?? [];
  list.push(event);
  byLegacyKey.set(event.legacyKey, list);
}

function findLocalEvent<T extends IndexedLocalEvent>(
  syncId: string | undefined,
  legacyKey: string,
  bySyncId: Map<string, T>,
  byLegacyKey: Map<string, T[]>,
): T | null {
  if (syncId) {
    const exact = bySyncId.get(syncId);
    if (exact) return exact;
  }
  return (
    byLegacyKey
      .get(legacyKey)
      ?.find((event) =>
        sameSyncEvent(
          { syncId, legacyKey },
          { syncId: event.sync_id, legacyKey: event.legacyKey },
        ),
      ) ?? null
  );
}

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
       VALUES ('Lista de Compras', 'active', ?, ?)`,
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
    // productNameKey (NFC + trim + lower pt-BR): mesma chave com que idPorNome é
    // construído. Sem o NFC, um nome com acento combinante não casava e o item
    // era descartado no apply. (auditoria #76)
    const productId = idPorNome.get(productNameKey(item.productName));
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
  type PurchaseRow = {
    id: number;
    sync_id: string | null;
    product_id: number;
    quantity: string;
    purchased_at: string;
    deleted: number;
    updated_at: string | null;
    legacyKey: string;
  };
  const rows = await database.getAllAsync<Omit<PurchaseRow, 'legacyKey'>>(`
    SELECT id, sync_id, product_id, quantity, purchased_at, deleted, updated_at
    FROM purchase_history
  `);
  const porSyncId = new Map<string, PurchaseRow>();
  const porChave = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    indexLocalEvent(
      { ...row, legacyKey: eventKey(String(row.product_id), row.purchased_at, row.quantity) },
      porSyncId,
      porChave,
    );
  }

  for (const compra of compras) {
    const productId = idPorNome.get(productNameKey(compra.productName)); // NFC (auditoria #76)
    if (!productId) continue;
    const chave = eventKey(String(productId), compra.purchasedAt, compra.quantity);
    const local = findLocalEvent(compra.syncId, chave, porSyncId, porChave);
    if (local) {
      // LWW do tombstone (shouldApplyIncomingDeleted, auditoria #65): edição
      // carimbada mais nova vence nas duas direções (excluir E re-incluir);
      // compra viva sem carimbo nunca ressuscita a exclusão local.
      const incomingDeleted = compra.deleted ?? false;
      if (compra.syncId && !local.sync_id) {
        await database.runAsync(
          'UPDATE purchase_history SET sync_id = ? WHERE id = ?',
          compra.syncId,
          local.id,
        );
        local.sync_id = compra.syncId;
        porSyncId.set(compra.syncId, local);
      }
      if (
        shouldApplyIncomingDeleted(
          { deleted: incomingDeleted, updatedAt: compra.updatedAt },
          { deleted: local.deleted === 1, updatedAt: local.updated_at },
        )
      ) {
        const carimbo = compra.updatedAt ?? new Date().toISOString();
        await database.runAsync(
          'UPDATE purchase_history SET deleted = ?, updated_at = ? WHERE id = ?',
          incomingDeleted ? 1 : 0,
          carimbo,
          local.id,
        );
        local.deleted = incomingDeleted ? 1 : 0;
        local.updated_at = carimbo;
      }
      continue;
    }
    const inserida = await database.runAsync(
      `INSERT INTO purchase_history
         (sync_id, product_id, quantity, purchased_at, source_list_id, source_list_name, deleted, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
      compra.syncId ?? null,
      productId,
      compra.quantity,
      compra.purchasedAt,
      compra.sourceListName ?? null,
      compra.deleted ? 1 : 0,
      compra.updatedAt ?? null,
    );
    indexLocalEvent({
      id: inserida.lastInsertRowId,
      sync_id: compra.syncId ?? null,
      product_id: productId,
      quantity: compra.quantity,
      purchased_at: compra.purchasedAt,
      deleted: compra.deleted ? 1 : 0,
      updated_at: compra.updatedAt ?? null,
      legacyKey: chave,
    }, porSyncId, porChave);
  }
}

async function aplicarPrecos(database: Db, idPorNome: Map<string, number>, precos: SyncSnapshot['prices']) {
  type PriceRow = {
    id: number;
    sync_id: string | null;
    product_id: number;
    price_cents: number;
    recorded_at: string;
    legacyKey: string;
  };
  const rows = await database.getAllAsync<Omit<PriceRow, 'legacyKey'>>(`
    SELECT id, sync_id, product_id, price_cents, recorded_at FROM price_history
  `);
  const porSyncId = new Map<string, PriceRow>();
  const porChave = new Map<string, PriceRow[]>();
  for (const row of rows) {
    indexLocalEvent(
      { ...row, legacyKey: eventKey(String(row.product_id), row.recorded_at, String(row.price_cents)) },
      porSyncId,
      porChave,
    );
  }
  const tocados = new Set<number>();

  for (const preco of precos) {
    const productId = idPorNome.get(productNameKey(preco.productName)); // NFC (auditoria #76)
    if (!productId) continue;
    const chave = eventKey(String(productId), preco.recordedAt, String(preco.priceCents));
    const local = findLocalEvent(preco.syncId, chave, porSyncId, porChave);
    if (local) {
      if (preco.syncId && !local.sync_id) {
        await database.runAsync(
          'UPDATE price_history SET sync_id = ? WHERE id = ?',
          preco.syncId,
          local.id,
        );
        local.sync_id = preco.syncId;
        porSyncId.set(preco.syncId, local);
      }
      continue;
    }
    const inserted = await database.runAsync(
      `INSERT INTO price_history (sync_id, product_id, price_cents, recorded_at)
       VALUES (?, ?, ?, ?)`,
      preco.syncId ?? null,
      productId,
      Math.round(preco.priceCents),
      preco.recordedAt,
    );
    indexLocalEvent(
      {
        id: inserted.lastInsertRowId,
        sync_id: preco.syncId ?? null,
        product_id: productId,
        price_cents: Math.round(preco.priceCents),
        recorded_at: preco.recordedAt,
        legacyKey: chave,
      },
      porSyncId,
      porChave,
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
  type InventoryEventRow = {
    id: number;
    sync_id: string | null;
    product_id: number;
    event_type: 'consumed' | 'set';
    quantity: string;
    occurred_at: string;
    legacyKey: string;
  };
  const rows = await database.getAllAsync<Omit<InventoryEventRow, 'legacyKey'>>(`
    SELECT id, sync_id, product_id, event_type, quantity, occurred_at
    FROM inventory_events
  `);
  const porSyncId = new Map<string, InventoryEventRow>();
  const porChave = new Map<string, InventoryEventRow[]>();
  for (const row of rows) {
    indexLocalEvent(
      {
        ...row,
        legacyKey: `${row.event_type}|${eventKey(String(row.product_id), row.occurred_at, row.quantity)}`,
      },
      porSyncId,
      porChave,
    );
  }
  const tocados = new Set<number>();

  for (const consumo of consumos) {
    const productId = idPorNome.get(productNameKey(consumo.productName)); // NFC (auditoria #76)
    if (!productId) continue;
    const eventType = consumo.eventType ?? 'consumed';
    const chave = `${eventType}|${eventKey(String(productId), consumo.occurredAt, consumo.quantity)}`;
    const local = findLocalEvent(consumo.syncId, chave, porSyncId, porChave);
    if (local) {
      if (consumo.syncId && !local.sync_id) {
        await database.runAsync(
          'UPDATE inventory_events SET sync_id = ? WHERE id = ?',
          consumo.syncId,
          local.id,
        );
        local.sync_id = consumo.syncId;
        porSyncId.set(consumo.syncId, local);
      }
      tocados.add(productId);
      continue;
    }
    const inserted = await database.runAsync(
      `INSERT INTO inventory_events (sync_id, product_id, event_type, quantity, occurred_at)
       VALUES (?, ?, ?, ?, ?)`,
      consumo.syncId ?? null,
      productId,
      eventType,
      consumo.quantity,
      consumo.occurredAt,
    );
    const row: InventoryEventRow = {
      id: inserted.lastInsertRowId,
      sync_id: consumo.syncId ?? null,
      product_id: productId,
      event_type: eventType,
      quantity: consumo.quantity,
      occurred_at: consumo.occurredAt,
      legacyKey: chave,
    };
    rows.push(row);
    indexLocalEvent(row, porSyncId, porChave);
    tocados.add(productId);
  }

  // Materializa o estoque pelo último `set` e por todos os deltas posteriores.
  // Dois UUIDs distintos nunca colapsam, mesmo com conteúdo/segundo iguais.
  // (#72/#73)
  for (const productId of tocados) {
    const eventos = rows.filter((row) => row.product_id === productId);
    if (!eventos.some((row) => row.event_type === 'set')) continue;
    const atual = await database.getFirstAsync<{ quantity: string }>(
      'SELECT quantity FROM inventory_items WHERE product_id = ? LIMIT 1',
      productId,
    );
    const quantity = deriveInventoryQuantity(
      eventos.map((row) => ({
        syncId: row.sync_id,
        eventType: row.event_type,
        quantity: row.quantity,
        occurredAt: row.occurred_at,
      })),
      atual?.quantity ?? '0 un',
    );
    const status = isEmptyQuantity(quantity) ? 'missing' : 'in_stock';
    const latestMs = Math.max(...eventos.map((row) => new Date(row.occurred_at).getTime()));
    const updatedAt = Number.isFinite(latestMs) ? new Date(latestMs).toISOString() : new Date().toISOString();
    await database.runAsync(
      `INSERT INTO inventory_items (product_id, quantity, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET
         quantity = excluded.quantity,
         status = excluded.status,
         updated_at = excluded.updated_at`,
      productId,
      quantity,
      status,
      updatedAt,
      updatedAt,
    );
    await database.runAsync(
      'UPDATE products SET status = ? WHERE id = ?',
      status === 'missing' ? 'missing' : 'active',
      productId,
    );
  }
}
