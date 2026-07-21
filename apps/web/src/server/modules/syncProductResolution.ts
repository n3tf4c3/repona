import { productNameKey } from "@repona/core";

export type SyncProductReference = {
  productSyncId?: string;
  productName: string;
};

export class SyncUnknownProductError extends Error {
  constructor() {
    super("SYNC_UNKNOWN_PRODUCT");
    this.name = "SyncUnknownProductError";
  }
}

export function resolveSyncProductReference(
  entry: SyncProductReference,
  idByName: ReadonlyMap<string, number>,
  idBySyncId: ReadonlyMap<string, number>
): number | undefined {
  return (
    (entry.productSyncId ? idBySyncId.get(entry.productSyncId) : undefined) ??
    idByName.get(productNameKey(entry.productName))
  );
}

export function assertSyncProductReferencesResolved(
  entries: readonly SyncProductReference[],
  idByName: ReadonlyMap<string, number>,
  idBySyncId: ReadonlyMap<string, number>
): void {
  if (entries.some((entry) => resolveSyncProductReference(entry, idByName, idBySyncId) === undefined)) {
    throw new SyncUnknownProductError();
  }
}
