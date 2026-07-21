import { productNameKey } from '@repona/core';

type SqlValue = string | number | null;

export type ProductIdentityDatabase = {
  getAllAsync<T>(sql: string, ...params: SqlValue[]): Promise<T[]>;
  runAsync(sql: string, ...params: SqlValue[]): Promise<unknown>;
};

export type MutableProductIdentity = {
  id: number;
  sync_id: string | null;
};

type IncomingProductIdentity = {
  syncId?: string;
  name: string;
};

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

export async function assertIncomingProductIdentitiesUnambiguous(
  database: ProductIdentityDatabase,
  products: IncomingProductIdentity[],
): Promise<void> {
  const nameKeys = new Set<string>();
  for (const product of products) {
    const key = productNameKey(product.name);
    if (nameKeys.has(key)) throw new Error('SYNC_PRODUCT_IDENTITY_CONFLICT');
    nameKeys.add(key);
  }

  const incomingIds = products.flatMap((product) => (product.syncId ? [product.syncId] : []));
  const uniqueIds = [...new Set(incomingIds)];
  if (uniqueIds.length !== incomingIds.length) {
    throw new Error('SYNC_PRODUCT_IDENTITY_CONFLICT');
  }
  if (uniqueIds.length === 0) return;

  const params = placeholders(uniqueIds.length);
  const matches = await database.getAllAsync<{
    incoming_sync_id: string;
    canonical_product_id: number;
  }>(
    `SELECT sync_id AS incoming_sync_id, id AS canonical_product_id
     FROM products
     WHERE sync_id IN (${params})
     UNION ALL
     SELECT old_sync_id AS incoming_sync_id, canonical_product_id
     FROM product_sync_aliases
     WHERE old_sync_id IN (${params})`,
    ...uniqueIds,
    ...uniqueIds,
  );

  const canonicalsByIncoming = new Map<string, Set<number>>();
  const incomingByCanonical = new Map<number, Set<string>>();
  for (const match of matches) {
    const canonicals = canonicalsByIncoming.get(match.incoming_sync_id) ?? new Set<number>();
    canonicals.add(match.canonical_product_id);
    canonicalsByIncoming.set(match.incoming_sync_id, canonicals);

    const identities = incomingByCanonical.get(match.canonical_product_id) ?? new Set<string>();
    identities.add(match.incoming_sync_id);
    incomingByCanonical.set(match.canonical_product_id, identities);
  }

  if (
    [...canonicalsByIncoming.values()].some((ids) => ids.size > 1) ||
    [...incomingByCanonical.values()].some((ids) => ids.size > 1)
  ) {
    throw new Error('SYNC_PRODUCT_IDENTITY_CONFLICT');
  }
}

export async function promoteRemoteProductSyncId(
  database: ProductIdentityDatabase,
  product: MutableProductIdentity,
  remoteSyncId: string,
  now: string,
): Promise<void> {
  if (product.sync_id === remoteSyncId) return;
  if (product.sync_id) {
    await database.runAsync(
      `INSERT INTO product_sync_aliases (old_sync_id, canonical_product_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(old_sync_id) DO UPDATE SET
         canonical_product_id = excluded.canonical_product_id`,
      product.sync_id,
      product.id,
      now,
    );
  }
  await database.runAsync('DELETE FROM product_sync_aliases WHERE old_sync_id = ?', remoteSyncId);
  await database.runAsync('UPDATE products SET sync_id = ? WHERE id = ?', remoteSyncId, product.id);
  product.sync_id = remoteSyncId;
}
