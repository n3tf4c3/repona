import type { SyncSnapshot } from "./sync";

export const SYNC_PROTOCOL_VERSION = 2 as const;

export const SYNC_COLLECTIONS = [
  "products",
  "purchases",
  "consumptions",
  "prices",
  "listItems",
] as const;

export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export type SyncHighWaterMarks = Readonly<Record<SyncCollection, number>> & {
  activeListId: number;
};

// Produtos geram mais writes (metadados + estoque + cache de status), enquanto
// eventos são append-only. Os limites diferentes mantêm cada transação curta e
// cada corpo bem abaixo do teto de 4,5 MB da plataforma. (#55/#74)
export const SYNC_PAGE_LIMITS: Readonly<Record<SyncCollection, number>> = {
  products: 100,
  purchases: 250,
  consumptions: 250,
  prices: 250,
  listItems: 200,
};

export function emptySyncHighWaterMarks(): SyncHighWaterMarks {
  return {
    products: 0,
    purchases: 0,
    consumptions: 0,
    prices: 0,
    listItems: 0,
    activeListId: 0,
  };
}

export function isSyncHighWaterMarks(value: unknown): value is SyncHighWaterMarks {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return [...SYNC_COLLECTIONS, "activeListId"].every((key) => {
    const mark = candidate[key];
    return typeof mark === "number" && Number.isSafeInteger(mark) && mark >= 0;
  });
}

export function emptySyncSnapshot(): SyncSnapshot {
  return {
    products: [],
    purchases: [],
    consumptions: [],
    prices: [],
    listItems: [],
  };
}

export function syncCollectionSize(
  snapshot: SyncSnapshot,
  collection: SyncCollection
): number {
  return collection === "listItems"
    ? (snapshot.listItems?.length ?? 0)
    : snapshot[collection].length;
}

export function syncSnapshotSize(snapshot: SyncSnapshot): number {
  return SYNC_COLLECTIONS.reduce(
    (total, collection) => total + syncCollectionSize(snapshot, collection),
    0
  );
}

export function isBoundedSyncPage(
  snapshot: SyncSnapshot,
  collection: SyncCollection
): boolean {
  return (
    syncSnapshotSize(snapshot) === syncCollectionSize(snapshot, collection) &&
    syncCollectionSize(snapshot, collection) <= SYNC_PAGE_LIMITS[collection]
  );
}
