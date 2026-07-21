import { eventKey, uuidv4, productNameKey, shouldApplyIncoming, shouldApplyIncomingDeleted, MAX_PRICE_CENTS, type SyncSnapshot } from '@repona/core';
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
    product_name: string;
    quantity: string;
    purchased_at: string;
    source_list_name: string | null;
    deleted: number;
    updated_at: string | null;
  }>(`
    SELECT p.name as product_name, ph.quantity, ph.purchased_at,
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
    product_name: string;
    quantity: string;
    occurred_at: string;
  }>(`
    SELECT p.name as product_name, ie.quantity, ie.occurred_at
    FROM inventory_events ie
    INNER JOIN products p ON p.id = ie.product_id
    WHERE ie.event_type = 'consumed'
  `);
  const consumos = consumosTodos.filter((c) => dentroDaJanela(c.occurred_at, cutoffMs));
  // Só preços dentro da faixa válida (1..MAX_PRICE_CENTS) e os 10 mais recentes
  // por produto. Dados legados/corrompidos (preço fora do teto, criados antes da
  // correção #29) travavam o sync inteiro com INVALID_BODY; e o histórico podia
  // estourar o limite do snapshot. (auditoria #41)
  const precos = await database.getAllAsync<{
    product_name: string;
    price_cents: number;
    recorded_at: string;
  }>(
    `SELECT product_name, price_cents, recorded_at FROM (
       SELECT p.name as product_name, ph.price_cents, ph.recorded_at,
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
      productName: c.product_name,
      quantity: c.quantity,
      purchasedAt: c.purchased_at,
      sourceListName: c.source_list_name,
      deleted: c.deleted === 1,
      updatedAt: c.updated_at,
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
// O caller valida a resposta remota com parseSyncSnapshot antes de chegar aqui.
export async function applySnapshot(snapshot: SyncSnapshot): Promise<void> {
  const database = await initializeDatabase();
  const now = new Date().toISOString();

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
        ? await database.getFirstAsync<{ id: number; name: string; updated_at: string }>(
            'SELECT id, name, updated_at FROM products WHERE sync_id = ? LIMIT 1',
            prod.syncId,
          )
        : null;

      if (!row && prod.barcode?.trim()) {
        // Casa por código de barras (não-nulo) quando o syncId não bate e antes
        // do nome; adota o syncId do servidor. Sem código não entra aqui, então
        // hortifrúti segue só pelo nome. Comparação com trim dos dois lados —
        // código legado com espaço nunca casaria. (auditoria #19, 2026-06-09 #9)
        const porBarcode = await database.getFirstAsync<{ id: number; name: string; updated_at: string }>(
          'SELECT id, name, updated_at FROM products WHERE trim(barcode) = ? LIMIT 1',
          prod.barcode.trim(),
        );
        if (porBarcode && prod.syncId) {
          await database.runAsync('UPDATE products SET sync_id = ? WHERE id = ?', prod.syncId, porBarcode.id);
        }
        row = porBarcode;
      }

      if (!row) {
        const porNome = await database.getFirstAsync<{ id: number; name: string; updated_at: string }>(
          'SELECT id, name, updated_at FROM products WHERE name_key = ? LIMIT 1',
          productNameKey(nome), // Unicode-aware, alinhado ao web (auditoria #76)
        );
        if (porNome && prod.syncId) {
          await database.runAsync('UPDATE products SET sync_id = ? WHERE id = ?', prod.syncId, porNome.id);
        }
        row = porNome;
      }

      let productId: number;

      if (row) {
        // Mesmo sem aplicar o produto (LWW abaixo), os eventos do snapshot com
        // este nome referem-se a este produto local. (auditoria 2026-06-09 #2)
        idPorNomeRecebido.set(productNameKey(prod.name), row.id);
        // LWW: registro mais antigo que o local não sobrescreve. (auditoria #2)
        if (!shouldApplyIncoming(prod.updatedAt, row.updated_at)) {
          continue;
        }
        // Renomeia só se o novo nome não pertence a outro produto local (evita
        // violar a unicidade); em colisão mantém o nome local e reconcilia depois.
        let nomeFinal = nome;
        if (productNameKey(prod.name) !== productNameKey(row.name)) {
          const colide = await database.getFirstAsync<{ id: number }>(
            'SELECT id FROM products WHERE name_key = ? AND id <> ? LIMIT 1',
            productNameKey(nome), // Unicode-aware (auditoria #76)
            row.id,
          );
          if (colide) nomeFinal = row.name;
        }
        // Se o barcode recebido já pertence a OUTRO produto local, não sobrescreve
        // (o produto casou por syncId/nome, não por barcode): manter o local
        // evita duplicar código de barras no SQLite, espelhando o backend, que
        // tem índice único parcial por casa+barcode. (auditoria #59)
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
             status = ?, alert_threshold = ?, archived = ?, occasional = ?, updated_at = ?
           WHERE id = ?`,
          nomeFinal,
          productNameKey(nomeFinal), // mantém name_key em sincronia (auditoria #76)
          prod.category,
          prod.brand ?? null,
          barcodeFinal,
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
          prod.updatedAt ?? now,
        );
        productId = inserido.lastInsertRowId;
        idPorNomeRecebido.set(productNameKey(prod.name), productId);
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
  // Dedupe por productId (estável), não pelo nome: após um renomeio o mesmo
  // evento podia chegar com nome antigo e ser inserido de novo. (auditoria #28)
  const existentes = await database.getAllAsync<{ id: number; product_id: number; quantity: string; purchased_at: string; deleted: number; updated_at: string | null }>(`
    SELECT id, product_id, quantity, purchased_at, deleted, updated_at FROM purchase_history
  `);
  const porChave = new Map(
    existentes.map((e) => [eventKey(String(e.product_id), e.purchased_at, e.quantity), e]),
  );

  for (const compra of compras) {
    const productId = idPorNome.get(productNameKey(compra.productName)); // NFC (auditoria #76)
    if (!productId) continue;
    const chave = eventKey(String(productId), compra.purchasedAt, compra.quantity);
    const local = porChave.get(chave);
    if (local) {
      // LWW do tombstone (shouldApplyIncomingDeleted, auditoria #65): edição
      // carimbada mais nova vence nas duas direções (excluir E re-incluir);
      // compra viva sem carimbo nunca ressuscita a exclusão local.
      const incomingDeleted = compra.deleted ?? false;
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
    // Tombstone de um evento que nunca existiu aqui: nada a apagar nem inserir.
    if (compra.deleted) continue;
    const inserida = await database.runAsync(
      `INSERT INTO purchase_history (product_id, quantity, purchased_at, source_list_id, source_list_name, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
      productId,
      compra.quantity,
      compra.purchasedAt,
      compra.sourceListName ?? null,
      compra.updatedAt ?? null,
    );
    porChave.set(chave, {
      id: inserida.lastInsertRowId,
      product_id: productId,
      quantity: compra.quantity,
      purchased_at: compra.purchasedAt,
      deleted: 0,
      updated_at: compra.updatedAt ?? null,
    });
  }
}

async function aplicarPrecos(database: Db, idPorNome: Map<string, number>, precos: SyncSnapshot['prices']) {
  // Dedupe por productId (estável), não pelo nome. (auditoria #28)
  const existentes = await database.getAllAsync<{ product_id: number; price_cents: number; recorded_at: string }>(`
    SELECT product_id, price_cents, recorded_at FROM price_history
  `);
  const vistos = new Set(existentes.map((e) => eventKey(String(e.product_id), e.recorded_at, String(e.price_cents))));
  const tocados = new Set<number>();

  for (const preco of precos) {
    const productId = idPorNome.get(productNameKey(preco.productName)); // NFC (auditoria #76)
    if (!productId) continue;
    const chave = eventKey(String(productId), preco.recordedAt, String(preco.priceCents));
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
  // Dedupe por productId (estável), não pelo nome. (auditoria #28)
  const existentes = await database.getAllAsync<{ product_id: number; quantity: string; occurred_at: string }>(`
    SELECT product_id, quantity, occurred_at
    FROM inventory_events
    WHERE event_type = 'consumed'
  `);
  const vistos = new Set(existentes.map((e) => eventKey(String(e.product_id), e.occurred_at, e.quantity)));

  for (const consumo of consumos) {
    const productId = idPorNome.get(productNameKey(consumo.productName)); // NFC (auditoria #76)
    if (!productId) continue;
    const chave = eventKey(String(productId), consumo.occurredAt, consumo.quantity);
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
