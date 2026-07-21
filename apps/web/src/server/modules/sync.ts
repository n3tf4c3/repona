import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/server/db";
import {
  products,
  inventoryItems,
  inventoryEvents,
  purchaseHistory,
  priceHistory,
  productSyncAliases,
  shoppingListItems,
  syncLocks,
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
  SYNC_PAGE_LIMITS,
  emptySyncSnapshot,
  type SyncCollection,
  type SyncHighWaterMarks,
  type SyncSnapshot,
} from "@repona/core";
import { garantirListaAtiva } from "@/server/modules/listas";
import {
  aliasForFallbackProductMatch,
  indexProductSyncAliases,
} from "@/server/modules/syncAliases";
import {
  buildSyncConcurrencyGuard,
  isSyncConcurrentUniqueViolation,
  isSyncConcurrencyGuardViolation,
  SyncConcurrentMutationError,
  type SyncConcurrencyExpectation,
} from "@/server/modules/syncConcurrencyGuard";
import { renewLock } from "@/server/rateLimit";
import { encodeSyncCursor, nextSyncCollection, type SyncCursor } from "@/server/syncCursor";
import { buildCasaMutationLock } from "@/server/modules/casaMutationLock";
import {
  assertSyncProductReferencesResolved,
  resolveSyncProductReference,
} from "@/server/modules/syncProductResolution";
import { isListItemWithinDownloadScope } from "@/server/syncDownloadScope";
import {
  buildSyncDownloadHighWaterQuery,
  syncDownloadHighWaterFromRow,
  type SyncDownloadHighWaterRow,
} from "@/server/modules/syncDownloadHighWater";

export { SyncConcurrentMutationError } from "@/server/modules/syncConcurrencyGuard";
export { SyncUnknownProductError } from "@/server/modules/syncProductResolution";

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

function productIdForSyncEntry(
  entry: { productSyncId?: string; productName: string },
  idPorNome: Map<string, number>,
  idPorSyncId: Map<string, number>
): number | undefined {
  return resolveSyncProductReference(entry, idPorNome, idPorSyncId);
}

function productReferencesForSnapshot(incoming: SyncSnapshot): {
  syncIds: string[];
  nameKeys: string[];
  barcodes: string[];
} {
  const children = [
    ...incoming.purchases,
    ...incoming.consumptions,
    ...incoming.prices,
    ...(incoming.listItems ?? []),
  ];
  return {
    syncIds: [
      ...new Set(
        [
          ...incoming.products.map((product) => product.syncId),
          ...children.map((entry) => entry.productSyncId),
        ].filter((value): value is string => Boolean(value))
      ),
    ],
    nameKeys: [
      ...new Set([
        ...incoming.products.map((product) => productNameKey(product.name)),
        ...children.map((entry) => productNameKey(entry.productName)),
      ]),
    ],
    barcodes: [
      ...new Set(
        incoming.products
          .map((product) => product.barcode?.trim())
          .filter((value): value is string => Boolean(value))
      ),
    ],
  };
}

// Uma escrita acumulada para o db.batch (que o neon-http executa como UMA
// transação). O merge calcula tudo primeiro e aplica de uma vez — antes eram
// dezenas de round-trips soltos e uma falha no meio deixava o snapshot
// meio-aplicado. (auditoria 2026-06-09 #12.3)
type Escrita = Parameters<typeof db.batch>[0][number];

export type SyncLockFence = {
  key: string;
  token: string;
  ttlSeconds: number;
};

export class SyncLockLostError extends Error {
  constructor() {
    super("SYNC_LOCK_LOST");
    this.name = "SyncLockLostError";
  }
}

async function renewOrThrow(fence: SyncLockFence | undefined): Promise<void> {
  if (fence && !(await renewLock(fence.key, fence.token, fence.ttlSeconds))) {
    throw new SyncLockLostError();
  }
}

function fenceWrite(fence: SyncLockFence): Escrita {
  // A linha fica FOR UPDATE até o fim do db.batch. Token/lease inválidos fazem
  // count=0 e abortam o batch por divisão por zero, antes de qualquer efeito.
  return db.execute(sql`
    with owned as materialized (
      select 1
      from ${syncLocks}
      where ${syncLocks.chave} = ${fence.key}
        and ${syncLocks.token} = ${fence.token}
        and ${syncLocks.expiraEm} > now()
      for update
    )
    select 1 / count(*)::int as fence from owned
  `) as unknown as Escrita;
}

type MergeCasaOptions = {
  returnSnapshot?: boolean;
  fence?: SyncLockFence;
};

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
  incoming: SyncSnapshot,
  options?: MergeCasaOptions & { returnSnapshot?: true }
): Promise<SyncSnapshot>;
export async function mergeCasaSnapshot(
  casaId: number,
  incoming: SyncSnapshot,
  options: MergeCasaOptions & { returnSnapshot: false }
): Promise<void>;
export async function mergeCasaSnapshot(
  casaId: number,
  incoming: SyncSnapshot,
  options: MergeCasaOptions = {}
): Promise<SyncSnapshot | void> {
  await renewOrThrow(options.fence);
  const references = productReferencesForSnapshot(incoming);
  const aliases =
    references.syncIds.length === 0
      ? []
      : await db
      .select({
        oldSyncId: productSyncAliases.oldSyncId,
        canonicalProductId: productSyncAliases.canonicalProductId,
      })
      .from(productSyncAliases)
      .where(
        and(
          eq(productSyncAliases.casaId, casaId),
          inArray(productSyncAliases.oldSyncId, references.syncIds)
        )
      );
  const identityFilters: SQL[] = [];
  if (references.syncIds.length > 0) {
    identityFilters.push(inArray(products.syncId, references.syncIds));
  }
  if (references.nameKeys.length > 0) {
    identityFilters.push(
      inArray(
        sql<string>`lower(normalize(btrim(${products.name}), NFC))`,
        references.nameKeys
      )
    );
  }
  if (references.barcodes.length > 0) {
    identityFilters.push(inArray(products.barcode, references.barcodes));
  }
  const canonicalAliasIds = [...new Set(aliases.map((alias) => alias.canonicalProductId))];
  if (canonicalAliasIds.length > 0) {
    identityFilters.push(inArray(products.id, canonicalAliasIds));
  }
  const existentes =
    identityFilters.length === 0
      ? []
      : await db
          .select({
            id: products.id,
            name: products.name,
            syncId: products.syncId,
            category: products.category,
            brand: products.brand,
            barcode: products.barcode,
            photoUri: products.photoUri,
            purchaseCount: products.purchaseCount,
            status: products.status,
            alertThreshold: products.alertThreshold,
            archived: products.archived,
            occasional: products.occasional,
            metadataUpdatedAt: products.updatedAt,
            inventoryQuantity: inventoryItems.quantity,
            inventoryStatus: inventoryItems.status,
            inventoryUpdatedAt: inventoryItems.updatedAt,
          })
          .from(products)
          .leftJoin(inventoryItems, eq(inventoryItems.productId, products.id))
          .where(and(eq(products.casaId, casaId), or(...identityFilters)));
  const concurrencyExpectation: SyncConcurrencyExpectation = {
    products: existentes.map((product) => ({
      id: product.id,
      syncId: product.syncId,
      name: product.name,
      category: product.category,
      brand: product.brand,
      barcode: product.barcode,
      photoUri: product.photoUri,
      purchaseCount: product.purchaseCount,
      status: product.status,
      alertThreshold: product.alertThreshold,
      archived: product.archived,
      occasional: product.occasional,
      updatedAt: product.metadataUpdatedAt.toISOString(),
    })),
    inventories: existentes.flatMap((product) =>
      product.inventoryUpdatedAt && product.inventoryQuantity && product.inventoryStatus
        ? [
            {
              productId: product.id,
              quantity: product.inventoryQuantity,
              status: product.inventoryStatus,
              updatedAt: product.inventoryUpdatedAt.toISOString(),
            },
          ]
        : []
    ),
  };
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
        syncId: p.syncId,
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

      const alias = aliasForFallbackProductMatch({
        incomingSyncId: prod.syncId,
        canonicalSyncId: info.syncId,
        canonicalProductId: productId,
        matchedBy: match.matchedBy,
      });
      if (alias) {
        escritas.push(
          db
            .insert(productSyncAliases)
            .values({
              casaId,
              oldSyncId: alias.oldSyncId,
              canonicalProductId: alias.canonicalProductId,
            })
            .onConflictDoNothing({
              target: [productSyncAliases.casaId, productSyncAliases.oldSyncId],
            })
        );
        // Eventos da mesma pagina e das paginas seguintes resolvem a identidade
        // recebida para o produto canonico, mesmo que o nome mude depois.
        idPorSyncId.set(alias.oldSyncId, productId);
        syncIdsAposentados.add(alias.oldSyncId);
      }

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
        syncId,
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
  assertSyncProductReferencesResolved(
    [
      ...incoming.purchases,
      ...incoming.consumptions,
      ...incoming.prices,
      ...(incoming.listItems ?? []),
    ],
    idParaEventos,
    idPorSyncId
  );

  escritas.push(...(await mesclarCompras(casaId, idParaEventos, idPorSyncId, incoming.purchases)));
  escritas.push(...(await mesclarConsumos(casaId, idParaEventos, idPorSyncId, incoming.consumptions)));
  escritas.push(...(await mesclarPrecos(casaId, idParaEventos, idPorSyncId, incoming.prices)));
  const listMerge = await mesclarItensLista(
    casaId,
    idParaEventos,
    idPorSyncId,
    incoming.listItems ?? []
  );
  escritas.push(...listMerge.writes);
  if (listMerge.expectation) concurrencyExpectation.activeList = listMerge.expectation;

  // purchase_count é derivado do histórico (auditoria #3): recalcula após o
  // merge das compras, em vez de confiar no valor do snapshot (que não soma
  // entre dispositivos). Dentro do batch (transação), o subselect já enxerga as
  // compras inseridas acima. O snapshot devolvido leva o valor recalculado.
  const purchaseProductIds = [
    ...new Set(
      incoming.purchases
        .map((entry) => productIdForSyncEntry(entry, idParaEventos, idPorSyncId))
        .filter((id): id is number => id !== undefined)
    ),
  ];
  if (purchaseProductIds.length > 0) {
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
        .where(and(eq(products.casaId, casaId), inArray(products.id, purchaseProductIds)))
    );
  }

  // Snapshot vazio é válido no endpoint legado; o batch só abre quando há
  // efeitos. No v2 isso também evita uma transação neutra por página.
  await renewOrThrow(options.fence);
  if (escritas.length > 0) {
    escritas.unshift(
      db.execute(buildSyncConcurrencyGuard(casaId, concurrencyExpectation)) as unknown as Escrita
    );
    if (options.fence) escritas.unshift(fenceWrite(options.fence));
    // Ordem critica: o mutex da casa vem antes do fence. Se esperarmos o mutex
    // segurando sync_locks, uma lease vencida nao poderia ser tomada e o worker
    // antigo acabaria escrevendo depois da expiracao. (#74)
    escritas.unshift(
      db.execute(buildCasaMutationLock(casaId)) as unknown as Escrita
    );
    try {
      await db.batch(escritas as unknown as Parameters<typeof db.batch>[0]);
    } catch (error) {
      if (
        isSyncConcurrencyGuardViolation(error) ||
        isSyncConcurrentUniqueViolation(error)
      ) {
        throw new SyncConcurrentMutationError();
      }
      if (
        options.fence &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "22012"
      ) {
        throw new SyncLockLostError();
      }
      throw error;
    }
  }

  if (options.returnSnapshot === false) return;
  return construirSnapshot(casaId);
}

async function mesclarPrecos(
  casaId: number,
  idPorNome: Map<string, number>,
  idPorSyncId: Map<string, number>,
  incoming: SyncSnapshot["prices"]
): Promise<Escrita[]> {
  if (incoming.length === 0) return [];
  const productIds = [
    ...new Set(
      incoming
        .map((entry) => productIdForSyncEntry(entry, idPorNome, idPorSyncId))
        .filter((id): id is number => id !== undefined)
    ),
  ];
  if (productIds.length === 0) return [];
  const incomingSyncIds = incoming.flatMap((entry) => (entry.syncId ? [entry.syncId] : []));
  const identityFilter = incoming.some((entry) => !entry.syncId)
    ? inArray(priceHistory.productId, productIds)
    : or(
        inArray(priceHistory.syncId, incomingSyncIds),
        and(isNull(priceHistory.syncId), inArray(priceHistory.productId, productIds))
      );
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
    .where(and(eq(products.casaId, casaId), identityFilter));
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
    const productId = productIdForSyncEntry(preco, idPorNome, idPorSyncId);
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
  idPorSyncId: Map<string, number>,
  incoming: SyncSnapshot["purchases"]
): Promise<Escrita[]> {
  if (incoming.length === 0) return [];
  const productIds = [
    ...new Set(
      incoming
        .map((entry) => productIdForSyncEntry(entry, idPorNome, idPorSyncId))
        .filter((id): id is number => id !== undefined)
    ),
  ];
  if (productIds.length === 0) return [];
  const incomingSyncIds = incoming.flatMap((entry) => (entry.syncId ? [entry.syncId] : []));
  const identityFilter = incoming.some((entry) => !entry.syncId)
    ? inArray(purchaseHistory.productId, productIds)
    : or(
        inArray(purchaseHistory.syncId, incomingSyncIds),
        and(isNull(purchaseHistory.syncId), inArray(purchaseHistory.productId, productIds))
      );
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
    .where(and(eq(products.casaId, casaId), identityFilter));
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
    const productId = productIdForSyncEntry(compra, idPorNome, idPorSyncId);
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
  idPorSyncId: Map<string, number>,
  incoming: SyncSnapshot["consumptions"]
): Promise<Escrita[]> {
  if (incoming.length === 0) return [];
  const productIds = [
    ...new Set(
      incoming
        .map((entry) => productIdForSyncEntry(entry, idPorNome, idPorSyncId))
        .filter((id): id is number => id !== undefined)
    ),
  ];
  if (productIds.length === 0) return [];
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
    // O saldo derivado precisa do baseline `set` e de todos os deltas dos
    // produtos tocados; ainda assim deixa de varrer eventos da casa inteira.
    .where(and(eq(products.casaId, casaId), inArray(inventoryEvents.productId, productIds)));
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
    const productId = productIdForSyncEntry(consumo, idPorNome, idPorSyncId);
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
  idPorSyncId: Map<string, number>,
  incoming: NonNullable<SyncSnapshot["listItems"]>
): Promise<{
  writes: Escrita[];
  expectation?: NonNullable<SyncConcurrencyExpectation["activeList"]>;
}> {
  if (incoming.length === 0) return { writes: [] };
  const relevantProductIds = [
    ...new Set(
      incoming
        .map((item) => productIdForSyncEntry(item, idPorNome, idPorSyncId))
        .filter((id): id is number => id !== undefined)
    ),
  ];
  if (relevantProductIds.length === 0) return { writes: [] };
  const lista = await garantirListaAtiva(casaId);

  const existentes = await db
    .select({
      productId: shoppingListItems.productId,
      quantity: shoppingListItems.quantity,
      checked: shoppingListItems.checked,
      deleted: shoppingListItems.deleted,
      updatedAt: shoppingListItems.updatedAt,
    })
    .from(shoppingListItems)
    .where(
      and(
        eq(shoppingListItems.shoppingListId, lista.id),
        inArray(shoppingListItems.productId, relevantProductIds)
      )
    );
  const porProduto = new Map(existentes.map((e) => [e.productId, e.updatedAt]));

  const escritas: Escrita[] = [];
  for (const item of incoming) {
    const productId = productIdForSyncEntry(item, idPorNome, idPorSyncId);
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
          inArray(shoppingListItems.productId, relevantProductIds),
          eq(shoppingListItems.deleted, true),
          lt(shoppingListItems.updatedAt, new Date(Date.now() - TOMBSTONE_TTL_MS))
        )
      )
  );

  return {
    writes: escritas,
    expectation: {
      id: lista.id,
      name: lista.name,
      status: lista.status,
      updatedAt: lista.updatedAt,
      relevantProductIds,
      items: existentes.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        checked: item.checked,
        deleted: item.deleted,
        updatedAt: item.updatedAt.toISOString(),
      })),
    },
  };
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
      productSyncId: products.syncId,
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
      productSyncId: products.syncId,
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
      productSyncId: products.syncId,
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
      productSyncId: products.syncId,
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
        productSyncId: p.productSyncId,
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
      productSyncId: c.productSyncId,
      productName: c.productName,
      quantity: c.quantity,
      purchasedAt: c.purchasedAt.toISOString(),
      sourceListName: c.sourceListName,
      deleted: c.deleted,
      updatedAt: c.updatedAt ? c.updatedAt.toISOString() : null,
    })),
    consumptions: linhasConsumos.map((c) => ({
      syncId: c.syncId ?? undefined,
      productSyncId: c.productSyncId,
      eventType: c.eventType as "consumed" | "set",
      productName: c.productName,
      quantity: c.quantity,
      occurredAt: c.occurredAt.toISOString(),
    })),
    prices: [...precosPorProduto.values()].flat(),
    listItems: linhasItens.map((i) => ({
      productSyncId: i.productSyncId,
      productName: i.productName,
      quantity: i.quantity,
      checked: i.checked,
      deleted: i.deleted,
      updatedAt: i.updatedAt.toISOString(),
    })),
  };
}

export type SyncDownloadPage = {
  snapshot: SyncSnapshot;
  nextCursor: string | null;
  collection: SyncCollection | null;
};

function cursorAfterRows(
  collection: SyncCollection,
  selectedIds: number[],
  hasMoreInCollection: boolean,
  highWater: SyncHighWaterMarks
): string | null {
  if (hasMoreInCollection) {
    return encodeSyncCursor({
      collection,
      afterId: selectedIds[selectedIds.length - 1] ?? 0,
      highWater,
    });
  }
  const next = nextSyncCollection(collection);
  return next ? encodeSyncCursor({ collection: next, afterId: 0, highWater }) : null;
}

async function captureDownloadHighWater(casaId: number): Promise<SyncHighWaterMarks> {
  // Primeiro statement adquire o mutex; o SELECT seguinte recebe um snapshot
  // READ COMMITTED novo, depois de qualquer writer anterior ter commitado.
  const [, result] = await db.batch([
    db.execute(buildCasaMutationLock(casaId)),
    db.execute<SyncDownloadHighWaterRow>(buildSyncDownloadHighWaterQuery(casaId)),
  ]);
  return syncDownloadHighWaterFromRow(result.rows[0]);
}

// Download keyset: nunca consulta nem serializa o snapshot integral. Produtos
// vêm primeiro para que eventos das páginas seguintes sempre encontrem a
// identidade local; cada resposta contém no máximo o custo definido no core.
export async function construirSnapshotPage(
  casaId: number,
  initialCursor: SyncCursor
): Promise<SyncDownloadPage> {
  let collection: SyncCollection | null = initialCursor.collection;
  let afterId = initialCursor.afterId;
  // Capturado uma única vez e carregado em todo cursor seguinte: inserts
  // concorrentes ficam para a próxima sessão e não estendem este download.
  const highWater = initialCursor.highWater ?? (await captureDownloadHighWater(casaId));

  while (collection) {
    const limit = SYNC_PAGE_LIMITS[collection];
    const snapshot = emptySyncSnapshot();

    if (collection === "products") {
      const rows = await db
        .select({
          id: products.id,
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
        .where(
          and(
            eq(products.casaId, casaId),
            gt(products.id, afterId),
            lte(products.id, highWater.products)
          )
        )
        .orderBy(asc(products.id))
        .limit(limit + 1);
      const selected = rows.slice(0, limit);
      if (selected.length > 0) {
        snapshot.products = selected.map((product) => ({
          syncId: product.syncId,
          updatedAt: product.metadataUpdatedAt.toISOString(),
          metadataUpdatedAt: product.metadataUpdatedAt.toISOString(),
          inventoryUpdatedAt: product.inventoryUpdatedAt?.toISOString(),
          name: product.name,
          category: product.category,
          brand: product.brand,
          barcode: product.barcode,
          purchaseCount: product.purchaseCount,
          status: product.status as SyncSnapshot["products"][number]["status"],
          alertThreshold: product.alertThreshold,
          inventoryQuantity: product.inventoryQuantity ?? "0 un",
          inventoryStatus: (product.inventoryStatus ??
            "missing") as SyncSnapshot["products"][number]["inventoryStatus"],
          archived: product.archived,
          occasional: product.occasional,
        }));
        return {
          snapshot,
          collection,
          nextCursor: cursorAfterRows(collection, selected.map((row) => row.id), rows.length > limit, highWater),
        };
      }
    } else if (collection === "purchases") {
      const rows = await db
        .select({
          id: purchaseHistory.id,
          syncId: purchaseHistory.syncId,
          productSyncId: products.syncId,
          productName: products.name,
          quantity: purchaseHistory.quantity,
          purchasedAt: purchaseHistory.purchasedAt,
          sourceListName: purchaseHistory.sourceListName,
          deleted: purchaseHistory.deleted,
          updatedAt: purchaseHistory.updatedAt,
        })
        .from(purchaseHistory)
        .innerJoin(products, eq(products.id, purchaseHistory.productId))
        .where(
          and(
            eq(products.casaId, casaId),
            gt(purchaseHistory.id, afterId),
            lte(purchaseHistory.id, highWater.purchases)
          )
        )
        .orderBy(asc(purchaseHistory.id))
        .limit(limit + 1);
      const selected = rows.slice(0, limit);
      if (selected.length > 0) {
        snapshot.purchases = selected.map((purchase) => ({
          syncId: purchase.syncId ?? undefined,
          productSyncId: purchase.productSyncId,
          productName: purchase.productName,
          quantity: purchase.quantity,
          purchasedAt: purchase.purchasedAt.toISOString(),
          sourceListName: purchase.sourceListName,
          deleted: purchase.deleted,
          updatedAt: purchase.updatedAt?.toISOString() ?? null,
        }));
        return {
          snapshot,
          collection,
          nextCursor: cursorAfterRows(collection, selected.map((row) => row.id), rows.length > limit, highWater),
        };
      }
    } else if (collection === "consumptions") {
      const rows = await db
        .select({
          id: inventoryEvents.id,
          syncId: inventoryEvents.syncId,
          productSyncId: products.syncId,
          productName: products.name,
          eventType: inventoryEvents.eventType,
          quantity: inventoryEvents.quantity,
          occurredAt: inventoryEvents.occurredAt,
        })
        .from(inventoryEvents)
        .innerJoin(products, eq(products.id, inventoryEvents.productId))
        .where(
          and(
            eq(products.casaId, casaId),
            gt(inventoryEvents.id, afterId),
            lte(inventoryEvents.id, highWater.consumptions)
          )
        )
        .orderBy(asc(inventoryEvents.id))
        .limit(limit + 1);
      const selected = rows.slice(0, limit);
      if (selected.length > 0) {
        snapshot.consumptions = selected.map((event) => ({
          syncId: event.syncId ?? undefined,
          productSyncId: event.productSyncId,
          productName: event.productName,
          eventType: event.eventType as "consumed" | "set",
          quantity: event.quantity,
          occurredAt: event.occurredAt.toISOString(),
        }));
        return {
          snapshot,
          collection,
          nextCursor: cursorAfterRows(collection, selected.map((row) => row.id), rows.length > limit, highWater),
        };
      }
    } else if (collection === "prices") {
      const rows = await db
        .select({
          id: priceHistory.id,
          syncId: priceHistory.syncId,
          productSyncId: products.syncId,
          productName: products.name,
          priceCents: priceHistory.priceCents,
          recordedAt: priceHistory.recordedAt,
        })
        .from(priceHistory)
        .innerJoin(products, eq(products.id, priceHistory.productId))
        .where(
          and(
            eq(products.casaId, casaId),
            gt(priceHistory.id, afterId),
            lte(priceHistory.id, highWater.prices)
          )
        )
        .orderBy(asc(priceHistory.id))
        .limit(limit + 1);
      const selected = rows.slice(0, limit);
      if (selected.length > 0) {
        snapshot.prices = selected.map((price) => ({
          syncId: price.syncId ?? undefined,
          productSyncId: price.productSyncId,
          productName: price.productName,
          priceCents: price.priceCents,
          recordedAt: price.recordedAt.toISOString(),
        }));
        return {
          snapshot,
          collection,
          nextCursor: cursorAfterRows(collection, selected.map((row) => row.id), rows.length > limit, highWater),
        };
      }
    } else {
      const rows = await db
        .select({
          id: shoppingListItems.id,
          itemCasaId: shoppingListItems.casaId,
          productCasaId: products.casaId,
          shoppingListId: shoppingListItems.shoppingListId,
          productSyncId: products.syncId,
          productName: products.name,
          quantity: shoppingListItems.quantity,
          checked: shoppingListItems.checked,
          deleted: shoppingListItems.deleted,
          updatedAt: shoppingListItems.updatedAt,
        })
        .from(shoppingListItems)
        .innerJoin(products, eq(products.id, shoppingListItems.productId))
        .where(
          and(
            eq(shoppingListItems.casaId, casaId),
            eq(products.casaId, casaId),
            eq(shoppingListItems.shoppingListId, highWater.activeListId),
            gt(shoppingListItems.id, afterId),
            lte(shoppingListItems.id, highWater.listItems)
          )
        )
        .orderBy(asc(shoppingListItems.id))
        .limit(limit + 1);
      const selected = rows
        .filter((row) => isListItemWithinDownloadScope(row, casaId, highWater))
        .slice(0, limit);
      if (selected.length > 0) {
        snapshot.listItems = selected.map((item) => ({
          productSyncId: item.productSyncId,
          productName: item.productName,
          quantity: item.quantity,
          checked: item.checked,
          deleted: item.deleted,
          updatedAt: item.updatedAt.toISOString(),
        }));
        return {
          snapshot,
          collection,
          nextCursor: cursorAfterRows(collection, selected.map((row) => row.id), rows.length > limit, highWater),
        };
      }
    }

    collection = nextSyncCollection(collection);
    afterId = 0;
  }

  return { snapshot: emptySyncSnapshot(), nextCursor: null, collection: null };
}
