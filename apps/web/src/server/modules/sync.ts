import "server-only";
import { and, desc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import { db } from "@/server/db";
import {
  products,
  inventoryItems,
  inventoryEvents,
  purchaseHistory,
  priceHistory,
  productSyncAliases,
  shoppingListItems,
} from "@/server/db/schema";
import {
  deriveInventoryQuantity,
  isEmptyQuantity,
  productNameKey,
  matchProduct,
  shouldApplyIncoming,
  shouldApplyIncomingDeleted,
  sameSyncEvent,
  uuidv4,
  normalizeQuantity,
  type SyncSnapshot,
} from "@repona/core";
import { garantirListaAtiva } from "@/server/modules/listas";
import { indexProductSyncAliases } from "@/server/modules/syncAliases";

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

function dataRecebidaOuAgora(value: string | undefined): Date {
  if (!value) return new Date();
  const date = new Date(value);
  // shouldApplyIncoming rejeita clock muito futuro nos updates; para inserts,
  // onde ainda não há relógio local para comparar, usamos o horário do servidor.
  return Number.isNaN(date.getTime()) || !shouldApplyIncoming(value, new Date(0).toISOString())
    ? new Date()
    : date;
}

async function reservarProductId(): Promise<number> {
  // Reserva o serial sem inserir linha. A sequência não é transacional (gaps são
  // normais), mas o produto com id explícito entra no MESMO db.batch do estoque
  // e dos eventos. Assim uma falha não deixa mais produto parcial. (#26)
  const result = await db.execute<{ id: number | string }>(
    sql`select nextval(pg_get_serial_sequence('products', 'id'))::int as id`
  );
  const id = Number(result.rows[0]?.id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("PRODUCT_ID_RESERVATION_FAILED");
  return id;
}

type IndexedEvent = { syncId: string | null; legacyKey: string };

function indexEvent<T extends IndexedEvent>(
  event: T,
  bySyncId: Map<string, T>,
  byLegacyKey: Map<string, T[]>
): void {
  if (event.syncId) bySyncId.set(event.syncId, event);
  const list = byLegacyKey.get(event.legacyKey) ?? [];
  list.push(event);
  byLegacyKey.set(event.legacyKey, list);
}

function findEvent<T extends IndexedEvent>(
  syncId: string | undefined,
  legacyKey: string,
  bySyncId: Map<string, T>,
  byLegacyKey: Map<string, T[]>
): T | null {
  if (syncId) {
    const exact = bySyncId.get(syncId);
    if (exact) return exact;
  }
  return (
    byLegacyKey
      .get(legacyKey)
      ?.find((event) => sameSyncEvent({ syncId, legacyKey }, event)) ?? null
  );
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
// Atomicidade: ids seriais de produtos novos são reservados antes, mas TODAS as
// linhas (produto, estoque, eventos, lista e contadores) são gravadas no mesmo
// db.batch transacional. Falha consome apenas um número da sequência; nenhum
// produto parcial persiste. (auditoria #26)
export async function mergeCasaSnapshot(
  casaId: number,
  incoming: SyncSnapshot
): Promise<SyncSnapshot> {
  const [existentes, aliases] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        syncId: products.syncId,
        barcode: products.barcode,
        metadataUpdatedAt: products.updatedAt,
        inventoryUpdatedAt: inventoryItems.updatedAt,
      })
      .from(products)
      .leftJoin(inventoryItems, eq(inventoryItems.productId, products.id))
      .where(eq(products.casaId, casaId)),
    db
      .select({
        oldSyncId: productSyncAliases.oldSyncId,
        canonicalProductId: productSyncAliases.canonicalProductId,
      })
      .from(productSyncAliases)
      .where(eq(productSyncAliases.casaId, casaId)),
  ]);
  const idPorNome = new Map(existentes.map((p) => [productNameKey(p.name), p.id]));
  const idPorSyncId = new Map(existentes.map((p) => [p.syncId, p.id]));
  const syncIdsAposentados = indexProductSyncAliases(idPorSyncId, aliases);
  // Só produtos com código não-nulo entram no mapa de barcode (hortifrúti sem
  // código nunca casa por aqui). Chave com trim() — o matchProduct também faz
  // trim no recebido, e um código legado com espaço nunca casaria. (auditoria
  // #19, 2026-06-09 #9)
  const idPorBarcode = new Map(
    existentes
      .filter((p) => p.barcode?.trim())
      .map((p) => [(p.barcode as string).trim(), p.id])
  );
  const infoPorId = new Map(
    existentes.map((p) => [
      p.id,
      {
        name: p.name,
        metadataUpdatedAt: p.metadataUpdatedAt,
        inventoryUpdatedAt: p.inventoryUpdatedAt,
        barcode: p.barcode,
      },
    ])
  );

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
    const identidadeAposentada = Boolean(prod.syncId && syncIdsAposentados.has(prod.syncId));
    let productId: number;

    const metadataIncoming = prod.metadataUpdatedAt ?? prod.updatedAt;
    const inventoryIncoming = prod.inventoryUpdatedAt ?? prod.updatedAt;
    const inventoryUpdatedAt = dataRecebidaOuAgora(inventoryIncoming);
    let aplicarEstoque = true;

    if (match.id !== null) {
      // Mesmo sem aplicar metadados/estoque (LWW abaixo), os eventos deste device
      // referem-se a este produto. (auditoria 2026-06-09 #2)
      productId = match.id;
      idPorNomeRecebido.set(productNameKey(prod.name), productId);
      const info = infoPorId.get(productId)!;

      // Metadados e estoque têm relógios independentes. Uma edição de nome no
      // device A não pode fazer o saldo mais recente do device B perder. (#2)
      // Alias é também tombstone de identidade: o saldo/eventos offline ainda
      // convergem, mas os metadados da duplicata aposentada não podem renomear
      // ou sobrescrever novamente o produto canônico. (auditoria #86)
      if (
        !identidadeAposentada &&
        shouldApplyIncoming(metadataIncoming, info.metadataUpdatedAt.toISOString())
      ) {
        const donoDoNome = idPorNome.get(productNameKey(prod.name));
        const nomeColide = donoDoNome !== undefined && donoDoNome !== productId;
        const nomeFinal = nomeColide ? info.name : prod.name.trim();
        const donoBarcode = prod.barcode ? idPorBarcode.get(prod.barcode) : undefined;
        const barcodeColide = donoBarcode !== undefined && donoBarcode !== productId;
        const barcodeFinal = barcodeColide ? info.barcode : prod.barcode;
        const metadataUpdatedAt = dataRecebidaOuAgora(metadataIncoming);

        escritas.push(
          db
            .update(products)
            .set({
              name: nomeFinal,
              category: prod.category,
              brand: prod.brand ?? null,
              barcode: barcodeFinal,
              alertThreshold: prod.alertThreshold,
              archived: prod.archived,
              occasional: prod.occasional,
              updatedAt: metadataUpdatedAt,
            })
            .where(eq(products.id, productId))
        );

        if (productNameKey(info.name) !== productNameKey(nomeFinal)) {
          idPorNome.delete(productNameKey(info.name));
          idPorNome.set(productNameKey(nomeFinal), productId);
        }
        if (info.barcode && info.barcode !== barcodeFinal) idPorBarcode.delete(info.barcode);
        if (barcodeFinal && !barcodeColide) idPorBarcode.set(barcodeFinal, productId);
        info.name = nomeFinal;
        info.barcode = barcodeFinal;
        info.metadataUpdatedAt = metadataUpdatedAt;
      }

      aplicarEstoque =
        info.inventoryUpdatedAt === null ||
        shouldApplyIncoming(inventoryIncoming, info.inventoryUpdatedAt.toISOString());
      if (aplicarEstoque) info.inventoryUpdatedAt = inventoryUpdatedAt;
    } else {
      productId = await reservarProductId();
      const syncId = prod.syncId ?? uuidv4();
      const metadataUpdatedAt = dataRecebidaOuAgora(metadataIncoming);
      escritas.push(
        db.insert(products).values({
          id: productId,
          casaId,
          syncId,
          name: prod.name.trim(),
          category: prod.category,
          brand: prod.brand ?? null,
          barcode: prod.barcode,
          status: prod.inventoryStatus === "missing" ? "missing" : "active",
          alertThreshold: prod.alertThreshold,
          archived: prod.archived,
          occasional: prod.occasional,
          updatedAt: metadataUpdatedAt,
        })
      );
      idPorNome.set(productNameKey(prod.name), productId);
      idPorNomeRecebido.set(productNameKey(prod.name), productId);
      idPorSyncId.set(syncId, productId);
      if (prod.barcode?.trim()) idPorBarcode.set(prod.barcode.trim(), productId);
      infoPorId.set(productId, {
        name: prod.name.trim(),
        metadataUpdatedAt,
        inventoryUpdatedAt,
        barcode: prod.barcode,
      });
    }

    if (aplicarEstoque) {
      escritas.push(
        db
          .insert(inventoryItems)
          .values({
            productId,
            quantity: prod.inventoryQuantity,
            status: prod.inventoryStatus,
            updatedAt: inventoryUpdatedAt,
          })
          .onConflictDoUpdate({
            target: inventoryItems.productId,
            set: {
              quantity: prod.inventoryQuantity,
              status: prod.inventoryStatus,
              updatedAt: inventoryUpdatedAt,
            },
          })
      );
      // products.status é cache derivado para telas antigas; não move o relógio
      // de metadados quando somente o estoque muda.
      escritas.push(
        db
          .update(products)
          .set({ status: prod.inventoryStatus === "missing" ? "missing" : "active" })
          .where(eq(products.id, productId))
      );
    }
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
            AND purchase_history.deleted = false
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
      id: priceHistory.id,
      syncId: priceHistory.syncId,
      productId: priceHistory.productId,
      priceCents: priceHistory.priceCents,
      recordedAt: priceHistory.recordedAt,
    })
    .from(priceHistory)
    .innerJoin(products, eq(products.id, priceHistory.productId))
    .where(eq(products.casaId, casaId));
  const porSyncId = new Map<string, (typeof existentes)[number] & IndexedEvent>();
  const porChave = new Map<string, Array<(typeof existentes)[number] & IndexedEvent>>();
  for (const event of existentes) {
    indexEvent(
      {
        ...event,
        legacyKey: `${event.productId}|${instanteEmSegundos(event.recordedAt)}|${event.priceCents}`,
      },
      porSyncId,
      porChave
    );
  }

  const escritas: Escrita[] = [];
  const tocados = new Set<number>();
  for (const preco of incoming) {
    const productId = idPorNome.get(productNameKey(preco.productName));
    if (!productId) continue;
    const at = new Date(preco.recordedAt);
    if (Number.isNaN(at.getTime())) continue;
    const legacyKey = `${productId}|${instanteEmSegundos(at)}|${Math.round(preco.priceCents)}`;
    const existente = findEvent(preco.syncId, legacyKey, porSyncId, porChave);
    if (existente) {
      if (preco.syncId && !existente.syncId) {
        escritas.push(
          db.update(priceHistory).set({ syncId: preco.syncId }).where(eq(priceHistory.id, existente.id))
        );
        existente.syncId = preco.syncId;
        porSyncId.set(preco.syncId, existente);
      }
      continue;
    }
    const syncId = preco.syncId ?? uuidv4();
    escritas.push(
      db
        .insert(priceHistory)
        .values({ syncId, productId, priceCents: Math.round(preco.priceCents), recordedAt: at })
    );
    indexEvent(
      { id: 0, syncId, productId, priceCents: Math.round(preco.priceCents), recordedAt: at, legacyKey },
      porSyncId,
      porChave
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
      id: purchaseHistory.id,
      syncId: purchaseHistory.syncId,
      productId: purchaseHistory.productId,
      quantity: purchaseHistory.quantity,
      purchasedAt: purchaseHistory.purchasedAt,
      deleted: purchaseHistory.deleted,
      updatedAt: purchaseHistory.updatedAt,
    })
    .from(purchaseHistory)
    .innerJoin(products, eq(products.id, purchaseHistory.productId))
    .where(eq(products.casaId, casaId));
  const porSyncId = new Map<string, (typeof existentes)[number] & IndexedEvent>();
  const porChave = new Map<string, Array<(typeof existentes)[number] & IndexedEvent>>();
  for (const event of existentes) {
    indexEvent(
      {
        ...event,
        legacyKey: `${event.productId}|${instanteEmSegundos(event.purchasedAt)}|${normalizeQuantity(event.quantity)}`,
      },
      porSyncId,
      porChave
    );
  }

  const escritas: Escrita[] = [];
  for (const compra of incoming) {
    const productId = idPorNome.get(productNameKey(compra.productName));
    if (!productId) continue;
    const at = new Date(compra.purchasedAt);
    if (Number.isNaN(at.getTime())) continue;
    const legacyKey = `${productId}|${instanteEmSegundos(at)}|${normalizeQuantity(compra.quantity)}`;
    const existente = findEvent(compra.syncId, legacyKey, porSyncId, porChave);
    if (existente) {
      // LWW do tombstone (shouldApplyIncomingDeleted, auditoria #65): edição
      // carimbada mais nova vence nas duas direções (excluir E re-incluir);
      // compra viva sem carimbo (cliente antigo) nunca ressuscita a exclusão.
      const incomingDeleted = compra.deleted ?? false;
      const updates: { syncId?: string; deleted?: boolean; updatedAt?: Date } = {};
      if (compra.syncId && !existente.syncId) {
        updates.syncId = compra.syncId;
        existente.syncId = compra.syncId;
        porSyncId.set(compra.syncId, existente);
      }
      if (
        shouldApplyIncomingDeleted(
          { deleted: incomingDeleted, updatedAt: compra.updatedAt },
          { deleted: existente.deleted, updatedAt: existente.updatedAt?.toISOString() }
        )
      ) {
        const carimbo = compra.updatedAt ? new Date(compra.updatedAt) : new Date();
        updates.deleted = incomingDeleted;
        updates.updatedAt = carimbo;
        existente.deleted = incomingDeleted;
        existente.updatedAt = carimbo;
      }
      if (Object.keys(updates).length > 0) {
        escritas.push(
          db.update(purchaseHistory).set(updates).where(eq(purchaseHistory.id, existente.id))
        );
      }
      continue;
    }
    // Tombstone de evento desconhecido: ninguém mais o tem (o merge nunca
    // apaga), então não há o que propagar.
    if (compra.deleted) continue;
    const carimbo = compra.updatedAt ? new Date(compra.updatedAt) : null;
    const syncId = compra.syncId ?? uuidv4();
    indexEvent(
      {
        id: 0,
        syncId,
        productId,
        quantity: compra.quantity,
        purchasedAt: at,
        deleted: false,
        updatedAt: carimbo,
        legacyKey,
      },
      porSyncId,
      porChave
    );
    escritas.push(
      db.insert(purchaseHistory).values({
        syncId,
        casaId,
        productId,
        quantity: compra.quantity,
        purchasedAt: at,
        sourceListName: compra.sourceListName ?? null,
        updatedAt: carimbo,
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
      id: inventoryEvents.id,
      syncId: inventoryEvents.syncId,
      productId: inventoryEvents.productId,
      eventType: inventoryEvents.eventType,
      quantity: inventoryEvents.quantity,
      occurredAt: inventoryEvents.occurredAt,
    })
    .from(inventoryEvents)
    .innerJoin(products, eq(products.id, inventoryEvents.productId))
    .where(eq(products.casaId, casaId));
  const porSyncId = new Map<string, (typeof existentes)[number] & IndexedEvent>();
  const porChave = new Map<string, Array<(typeof existentes)[number] & IndexedEvent>>();
  const eventosPorProduto = new Map<number, Array<(typeof existentes)[number]>>();
  for (const event of existentes) {
    const lista = eventosPorProduto.get(event.productId) ?? [];
    lista.push(event);
    eventosPorProduto.set(event.productId, lista);
    indexEvent(
      {
        ...event,
        legacyKey: `${event.eventType}|${event.productId}|${instanteEmSegundos(event.occurredAt)}|${normalizeQuantity(event.quantity)}`,
      },
      porSyncId,
      porChave
    );
  }

  const escritas: Escrita[] = [];
  const tocados = new Set<number>();
  for (const consumo of incoming) {
    const productId = idPorNome.get(productNameKey(consumo.productName));
    if (!productId) continue;
    const at = new Date(consumo.occurredAt);
    if (Number.isNaN(at.getTime())) continue;
    const eventType = consumo.eventType ?? "consumed";
    const legacyKey = `${eventType}|${productId}|${instanteEmSegundos(at)}|${normalizeQuantity(consumo.quantity)}`;
    const existente = findEvent(consumo.syncId, legacyKey, porSyncId, porChave);
    if (existente) {
      if (consumo.syncId && !existente.syncId) {
        escritas.push(
          db
            .update(inventoryEvents)
            .set({ syncId: consumo.syncId })
            .where(eq(inventoryEvents.id, existente.id))
        );
        existente.syncId = consumo.syncId;
        porSyncId.set(consumo.syncId, existente);
      }
      continue;
    }
    const syncId = consumo.syncId ?? uuidv4();
    escritas.push(
      db
        .insert(inventoryEvents)
        .values({ syncId, productId, eventType, quantity: consumo.quantity, occurredAt: at })
    );
    const novo = {
      id: 0,
      syncId,
      productId,
      eventType,
      quantity: consumo.quantity,
      occurredAt: at,
    };
    const lista = eventosPorProduto.get(productId) ?? [];
    lista.push(novo);
    eventosPorProduto.set(productId, lista);
    indexEvent(
      { ...novo, legacyKey },
      porSyncId,
      porChave
    );
    tocados.add(productId);
  }

  if (tocados.size > 0) {
    const saldos = await db
      .select({
        productId: inventoryItems.productId,
        quantity: inventoryItems.quantity,
        updatedAt: inventoryItems.updatedAt,
      })
      .from(inventoryItems)
      .where(inArray(inventoryItems.productId, [...tocados]));
    const saldoPorProduto = new Map(saldos.map((saldo) => [saldo.productId, saldo]));

    for (const productId of tocados) {
      const eventos = eventosPorProduto.get(productId) ?? [];
      if (!eventos.some((event) => event.eventType === "set")) continue;
      const atual = saldoPorProduto.get(productId);
      const quantity = deriveInventoryQuantity(
        eventos.map((event) => ({
          syncId: event.syncId,
          eventType: event.eventType as "consumed" | "set",
          quantity: event.quantity,
          occurredAt: event.occurredAt.toISOString(),
        })),
        atual?.quantity ?? "0 un"
      );
      const status = isEmptyQuantity(quantity) ? "missing" : "in_stock";
      const latestEventMs = Math.max(...eventos.map((event) => event.occurredAt.getTime()));
      const updatedAt = new Date(
        Math.max(latestEventMs, atual?.updatedAt.getTime() ?? 0)
      );
      escritas.push(
        db
          .insert(inventoryItems)
          .values({ productId, quantity, status, updatedAt })
          .onConflictDoUpdate({
            target: inventoryItems.productId,
            set: { quantity, status, updatedAt },
          })
      );
      escritas.push(
        db
          .update(products)
          .set({ status: status === "missing" ? "missing" : "active" })
          .where(eq(products.id, productId))
      );
    }
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
      metadataUpdatedAt: products.updatedAt,
      name: products.name,
      category: products.category,
      brand: products.brand,
      barcode: products.barcode,
      purchaseCount: products.purchaseCount,
      status: products.status,
      alertThreshold: products.alertThreshold,
      archived: products.archived,
      occasional: products.occasional,
      inventoryQuantity: inventoryItems.quantity,
      inventoryStatus: inventoryItems.status,
      inventoryUpdatedAt: inventoryItems.updatedAt,
    })
    .from(products)
    .leftJoin(inventoryItems, eq(inventoryItems.productId, products.id))
    .where(eq(products.casaId, casaId));

  // Inclui tombstones (deleted), para a exclusão de compra propagar para os
  // outros devices — mesmo racional dos itens de lista abaixo.
  const linhasCompras = await db
    .select({
      syncId: purchaseHistory.syncId,
      productName: products.name,
      quantity: purchaseHistory.quantity,
      purchasedAt: purchaseHistory.purchasedAt,
      sourceListName: purchaseHistory.sourceListName,
      deleted: purchaseHistory.deleted,
      updatedAt: purchaseHistory.updatedAt,
    })
    .from(purchaseHistory)
    .innerJoin(products, eq(products.id, purchaseHistory.productId))
    .where(eq(products.casaId, casaId));

  const linhasConsumos = await db
    .select({
      syncId: inventoryEvents.syncId,
      productName: products.name,
      eventType: inventoryEvents.eventType,
      quantity: inventoryEvents.quantity,
      occurredAt: inventoryEvents.occurredAt,
    })
    .from(inventoryEvents)
    .innerJoin(products, eq(products.id, inventoryEvents.productId))
    .where(eq(products.casaId, casaId));

  const linhasPrecos = await db
    .select({
      syncId: priceHistory.syncId,
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
        syncId: p.syncId ?? undefined,
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
      // updatedAt continua espelhando metadados para clientes v1; v2 usa os
      // dois campos separados abaixo. (#2, #67)
      updatedAt: p.metadataUpdatedAt.toISOString(),
      metadataUpdatedAt: p.metadataUpdatedAt.toISOString(),
      inventoryUpdatedAt: p.inventoryUpdatedAt?.toISOString(),
      name: p.name,
      category: p.category,
      brand: p.brand,
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
      syncId: c.syncId ?? undefined,
      productName: c.productName,
      quantity: c.quantity,
      purchasedAt: c.purchasedAt.toISOString(),
      sourceListName: c.sourceListName,
      deleted: c.deleted,
      updatedAt: c.updatedAt ? c.updatedAt.toISOString() : null,
    })),
    consumptions: linhasConsumos.map((c) => ({
      syncId: c.syncId ?? undefined,
      eventType: c.eventType as "consumed" | "set",
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
