import { productNameKey } from '@repona/core';

export type SyncProductReference = { productSyncId?: string; productName: string };

export class UnknownLocalSyncProductError extends Error {
  constructor() {
    super('UNKNOWN_LOCAL_SYNC_PRODUCT');
    this.name = 'UnknownLocalSyncProductError';
  }
}

export function localProductIdForSyncEntry(
  entry: SyncProductReference,
  idPorNome: Map<string, number>,
  idPorSyncId: Map<string, number>,
): number | undefined {
  return (
    (entry.productSyncId ? idPorSyncId.get(entry.productSyncId) : undefined) ??
    idPorNome.get(productNameKey(entry.productName))
  );
}

export function assertLocalSyncProductReferencesResolved(
  entries: SyncProductReference[],
  idPorNome: Map<string, number>,
  idPorSyncId: Map<string, number>,
): void {
  if (entries.some((entry) => !localProductIdForSyncEntry(entry, idPorNome, idPorSyncId))) {
    throw new UnknownLocalSyncProductError();
  }
}
