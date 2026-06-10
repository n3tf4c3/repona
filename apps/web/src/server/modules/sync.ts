import "server-only";
import { and, desc, eq, lt, notInArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  products,
  inventoryItems,
  inventoryEvents,
  purchaseHistory,
  priceHistory,
  shoppingListItems,
} from "@/server/db/schema";
import { productNameKey, matchProduct, shouldApplyIncoming, normalizeQuantity, type SyncSnapshot } from "@repona/core";
import { garantirListaAtiva } from "@/server/modules/listas";

// Tombstones de item de lista mais antigos que isto são podados (já propagaram a
// deleção). Um device offline por mais que isso pode reviver um item. (auditoria #9)
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const MAX_PRICES_PER_PRODUCT = 10;

// Instante em segundos de epoch: o dedupe normaliza o timestamp para tolerar
// diferenças de fração de segundo/formato no ida-e-volta entre mobile e nuvem
// (mesma lógica do eventKey do core). A quantidade é comparada com trim().
function instanteEmSegundos(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

// Uma escrita acumulada para o db.batch (que o neon-http executa como UMA
// transação). O merge calcula tudo primeiro e aplica de uma vez — antes eram
// dezenas de round-trips soltos e uma falha no meio deixava o snapshot
// meio-aplicado. (auditoria 2026-06-09 #12.3)
type Escrita = Parameters<typeof db.batch>[0][number];

// Merge do snapshot do mobile na casa, devolvendo o snapshot mesclado.
// Regras: produto casa por nome (o celular vence nos campos); compras e consumos
// são append-only com dedupe por produto+instante+quantidade. Nada é apagado.
//
// Atomicidade: produtos NOVOS são inseridos individualmente (precisamos do id
// retornado para o estoque e para resolver os eventos); todas as demais
// escritas — updates de produto, estoque, compras, consumos, preços, itens de
// lista, podas e purchase_count — vão num único db.batch. Se o batch falhar,
// só os produtos novos persistem, e o retry os reconcilia por syncId (o merge é
// idempotente). O lock por casa na rota já impede merges concorrentes.
export async function mergeCasaSnapshot(
  casaId: number,
  incoming: SyncSnapshot
): Promise<SyncSnapshot> {
  const existentes = await db
    .select({
      id: products.id,
      name: products.name,
      syncId: products.syncId,
      barcode: products.barcode,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(eq(products.casaId, casaId));
  const idPorNome = new Map(existentes.map((p) => [productNameKey(p.name), p.id]));
  const idPorSyncId = new Map(existentes.map((p) => [p.syncId, p.id]));
  // Só produtos com código não-nulo entram no mapa de barcode (hortifrúti sem
  // código nunca casa por aqui). Chave com trim() — o matchProduct também faz
  // trim no recebido, e um código legado com espaço nunca casaria. (auditoria
  // #19, 2026-06-09 #9)
  const idPorBarcode = new Map(
    existentes
      .filter((p) => p.barcode?.trim())
      .map((p) => [(p.barcode as string).trim(), p.id])
  );
  const infoPorId = new Map(existentes.map((p) => [p.id, { name: p.name, updatedAt: p.updatedAt }]));

  // Nome RECEBIDO → produto resolvido pelo matchProduct. Os eventos do snapshot
  // (compras/consumos/preços/itens) viajam com o nome que o device usa, que pode
  // não existir no banco quando o LWW pula o produto ou um renomeio colide —
  // resolver só por idPorNome descartava o evento em silêncio ou o atribuía ao
  // produto errado. (auditoria 2026-06-09 #2)
  const idPorNomeRecebido = new Map<string, number>();

  const escritas: Escrita[] = [];

  for (const prod of incoming.products) {
    // Casa por syncId, depois barcode, cai para o nome (legado). Em match, o
    // syncId do servidor é autoritativo: não sobrescrevemos products.syncId. (auditoria #1)
    const match = matchProduct(prod, {
      idBySyncId: idPorSyncId,
      idByName: idPorNome,
      idByBarcode: idPorBarcode,
    });
    let productId: number;

    if (match.id !== null) {
      // Mesmo sem aplicar o produto (LWW abaixo), os eventos deste device
      // referem-se a este produto. (auditoria 2026-06-09 #2)
      idPorNomeRecebido.set(productNameKey(prod.name), match.id);
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

      escritas.push(
        db
          .update(products)
          .set({
            name: nomeFinal,
            category: prod.category,
            barcode: prod.barcode,
            status: prod.status,
            alertThreshold: prod.alertThreshold,
            archived: prod.archived,
            occasional: prod.occasional,
            updatedAt: novoUpdatedAt,
          })
          .where(eq(products.id, match.id))
      );

      if (productNameKey(info.name) !== productNameKey(nomeFinal)) {
        idPorNome.delete(productNameKey(info.name));
        idPorNome.set(productNameKey(nomeFinal), match.id);
      }
      infoPorId.set(match.id, { name: nomeFinal, updatedAt: novoUpdatedAt });
      if (prod.barcode?.trim()) idPorBarcode.set(prod.barcode.trim(), match.id);
      productId = match.id;
    } else {
      // Insert individual: o id retornado é necessário já no loop (estoque e
      // resolução de eventos). Caminho raro — produto novo para o servidor.
      const [novo] = await db
        .insert(products)
        .values({
          casaId,
          syncId: prod.syncId,
          name: prod.name.trim(),
          category: prod.category,
          barcode: prod.barcode,
          status: prod.status,
          alertThreshold: prod.alertThreshold,
          archived: prod.archived,
          occasional: prod.occasional,
          updatedAt: prod.updatedAt ? new Date(prod.updatedAt) : undefined,
        })
        .returning({ id: products.id, syncId: products.syncId });
      productId = novo.id;
      idPorNome.set(productNameKey(prod.name), productId);
      idPorNomeRecebido.set(productNameKey(prod.name), productId);
      idPorSyncId.set(novo.syncId, productId);
      if (prod.barcode?.trim()) idPorBarcode.set(prod.barcode.trim(), productId);
      infoPorId.set(productId, {
        name: prod.name.trim(),
        updatedAt: prod.updatedAt ? new Date(prod.updatedAt) : new Date(),
      });
    }

    escritas.push(
      db
        .insert(inventoryItems)
        .values({ productId, quantity: prod.inventoryQuantity, status: prod.inventoryStatus })
        .onConflictDoUpdate({
          target: inventoryItems.productId,
          set: { quantity: prod.inventoryQuantity, status: prod.inventoryStatus, updatedAt: new Date() },
        })
    );
  }

  // Resolução dos eventos: o mapeamento dos nomes recebidos (via matchProduct)
  // tem precedência sobre os nomes atuais do banco. (auditoria 2026-06-09 #2)
  const idParaEventos = new Map([...idPorNome, ...idPorNomeRecebido]);

  escritas.push(...(await mesclarCompras(casaId, idParaEventos, incoming.purchases)));
  escritas.push(...(await mesclarConsumos(casaId, idParaEventos, incoming.consumptions)));
  escritas.push(...(await mesclarPrecos(casaId, idParaEventos, incoming.prices)));
  escritas.push(...(await mesclarItensLista(casaId, idParaEventos, incoming.listItems ?? [])));

  // purchase_count é derivado do histórico (auditoria #3): recalcula após o
  // merge das compras, em vez de confiar no valor do snapshot (que não soma
  // entre dispositivos). Dentro do batch (transação), o subselect já enxerga as
  // compras inseridas acima. O snapshot devolvido leva o valor recalculado.
  escritas.push(
    db
      .update(products)
      .set({
        purchaseCount: sql<number>`(
          SELECT COUNT(*)::int FROM purchase_history
          WHERE purchase_history.product_id = ${products.id}
        )`,
      })
      .where(eq(products.casaId, casaId))
  );

  // db.batch exige tupla não-vazia; o update de purchase_count acima garante
  // pelo menos um item.
  await db.batch(escritas as unknown as Parameters<typeof db.batch>[0]);

  return construirSnapshot(casaId);
}

async function mesclarPrecos(
  casaId: number,
  idPorNome: Map<string, number>,
  incoming: SyncSnapshot["prices"]
): Promise<Escrita[]> {
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

  const escritas: Escrita[] = [];
  const tocados = new Set<number>();
  for (const preco of incoming) {
    const productId = idPorNome.get(productNameKey(preco.productName));
    if (!productId) continue;
    const at = new Date(preco.recordedAt);
    if (Number.isNaN(at.getTime())) continue;
    const chave = `${productId}|${instanteEmSegundos(at)}|${Math.round(preco.priceCents)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    escritas.push(
      db
        .insert(priceHistory)
        .values({ productId, priceCents: Math.round(preco.priceCents), recordedAt: at })
    );
    tocados.add(productId);
  }

  // Mantém só os 10 preços mais recentes por produto tocado — mesma retenção do
  // mobile; antes o Postgres acumulava sem limite. Dentro do batch, o DELETE já
  // enxerga os inserts acima. (auditoria 2026-06-09 #6)
  for (const productId of tocados) {
    escritas.push(
      db.delete(priceHistory).where(
        and(
          eq(priceHistory.productId, productId),
          notInArray(
            priceHistory.id,
            db
              .select({ id: priceHistory.id })
              .from(priceHistory)
              .where(eq(priceHistory.productId, productId))
              .orderBy(desc(priceHistory.recordedAt), desc(priceHistory.id))
              .limit(MAX_PRICES_PER_PRODUCT)
          )
        )
      )
    );
  }

  return escritas;
}

async function mesclarCompras(
  casaId: number,
  idPorNome: Map<string, number>,
  incoming: SyncSnapshot["purchases"]
): Promise<Escrita[]> {
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
    existentes.map((e) => `${e.productId}|${instanteEmSegundos(e.purchasedAt)}|${normalizeQuantity(e.quantity)}`)
  );

  const escritas: Escrita[] = [];
  for (const compra of incoming) {
    const productId = idPorNome.get(productNameKey(compra.productName));
    if (!productId) continue;
    const at = new Date(compra.purchasedAt);
    if (Number.isNaN(at.getTime())) continue;
    const chave = `${productId}|${instanteEmSegundos(at)}|${normalizeQuantity(compra.quantity)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    escritas.push(
      db.insert(purchaseHistory).values({
        casaId,
        productId,
        quantity: compra.quantity,
        purchasedAt: at,
        sourceListName: compra.sourceListName ?? null,
      })
    );
  }
  return escritas;
}

async function mesclarConsumos(
  casaId: number,
  idPorNome: Map<string, number>,
  incoming: SyncSnapshot["consumptions"]
): Promise<Escrita[]> {
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
    existentes.map((e) => `${e.productId}|${instanteEmSegundos(e.occurredAt)}|${normalizeQuantity(e.quantity)}`)
  );

  const escritas: Escrita[] = [];
  for (const consumo of incoming) {
    const productId = idPorNome.get(productNameKey(consumo.productName));
    if (!productId) continue;
    const at = new Date(consumo.occurredAt);
    if (Number.isNaN(at.getTime())) continue;
    const chave = `${productId}|${instanteEmSegundos(at)}|${normalizeQuantity(consumo.quantity)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    escritas.push(
      db
        .insert(inventoryEvents)
        .values({ productId, eventType: "consumed", quantity: consumo.quantity, occurredAt: at })
    );
  }
  return escritas;
}

async function mesclarItensLista(
  casaId: number,
  idPorNome: Map<string, number>,
  incoming: NonNullable<SyncSnapshot["listItems"]>
): Promise<Escrita[]> {
  const lista = await garantirListaAtiva(casaId);

  const existentes = await db
    .select({
      productId: shoppingListItems.productId,
      updatedAt: shoppingListItems.updatedAt,
    })
    .from(shoppingListItems)
    .where(eq(shoppingListItems.shoppingListId, lista.id));
  const porProduto = new Map(existentes.map((e) => [e.productId, e.updatedAt]));

  const escritas: Escrita[] = [];
  for (const item of incoming) {
    const productId = idPorNome.get(productNameKey(item.productName));
    if (!productId) continue;
    const atualUpdatedAt = porProduto.get(productId);
    const novoUpdatedAt = item.updatedAt ? new Date(item.updatedAt) : new Date();

    if (atualUpdatedAt !== undefined) {
      // LWW: só aplica o recebido se for mais novo que o local. (auditoria #9)
      if (!shouldApplyIncoming(item.updatedAt, atualUpdatedAt.toISOString())) continue;
      escritas.push(
        db
          .update(shoppingListItems)
          .set({
            quantity: item.quantity,
            checked: item.checked,
            deleted: item.deleted,
            updatedAt: novoUpdatedAt,
          })
          .where(
            and(
              eq(shoppingListItems.shoppingListId, lista.id),
              eq(shoppingListItems.productId, productId)
            )
          )
      );
      porProduto.set(productId, novoUpdatedAt);
    } else {
      escritas.push(
        db.insert(shoppingListItems).values({
          casaId,
          shoppingListId: lista.id,
          productId,
          quantity: item.quantity,
          checked: item.checked,
          deleted: item.deleted,
          updatedAt: novoUpdatedAt,
        })
      );
      porProduto.set(productId, novoUpdatedAt);
    }
  }

  // Poda tombstones já propagados (mais velhos que o TTL). (auditoria #9)
  escritas.push(
    db
      .delete(shoppingListItems)
      .where(
        and(
          eq(shoppingListItems.shoppingListId, lista.id),
          eq(shoppingListItems.deleted, true),
          lt(shoppingListItems.updatedAt, new Date(Date.now() - TOMBSTONE_TTL_MS))
        )
      )
  );

  return escritas;
}

async function construirSnapshot(casaId: number): Promise<SyncSnapshot> {
  const linhasProdutos = await db
    .select({
      syncId: products.syncId,
      updatedAt: products.updatedAt,
      name: products.name,
      category: products.category,
      barcode: products.barcode,
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
      sourceListName: purchaseHistory.sourceListName,
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

  // Itens da lista ativa, inclusive tombstones (deleted), para a deleção
  // propagar para os outros devices. (auditoria #9)
  const listaAtiva = await garantirListaAtiva(casaId);
  const linhasItens = await db
    .select({
      productName: products.name,
      quantity: shoppingListItems.quantity,
      checked: shoppingListItems.checked,
      deleted: shoppingListItems.deleted,
      updatedAt: shoppingListItems.updatedAt,
    })
    .from(shoppingListItems)
    .innerJoin(products, eq(products.id, shoppingListItems.productId))
    .where(eq(shoppingListItems.shoppingListId, listaAtiva.id));

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
      sourceListName: c.sourceListName,
    })),
    consumptions: linhasConsumos.map((c) => ({
      productName: c.productName,
      quantity: c.quantity,
      occurredAt: c.occurredAt.toISOString(),
    })),
    prices: [...precosPorProduto.values()].flat(),
    listItems: linhasItens.map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      checked: i.checked,
      deleted: i.deleted,
      updatedAt: i.updatedAt.toISOString(),
    })),
  };
}
