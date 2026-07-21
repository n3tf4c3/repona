export const DEFAULT_PURCHASE_HISTORY_PAGE_SIZE = 20;
export const MAX_PURCHASE_HISTORY_PAGE_SIZE = 50;

export type PurchaseHistoryCursor = {
  purchasedAt: string;
  sourceNameKey: string;
};

export type PurchaseHistoryKey = {
  purchasedAt: string;
  sourceNameKey: string;
};

export type GroupablePurchaseHistoryRecord = {
  purchasedAt: string;
  sourceListName: string | null;
};

export type GroupedPurchaseHistory<T extends GroupablePurchaseHistoryRecord> = {
  key: string;
  purchasedAt: string;
  sourceListName: string | null;
  records: T[];
};

export type MergeableHistoryGroup<T extends { id: string }> = {
  title: string;
  items: T[];
};

export function normalizePurchaseHistoryLimit(limit?: number): number {
  if (!Number.isInteger(limit)) return DEFAULT_PURCHASE_HISTORY_PAGE_SIZE;
  return Math.min(Math.max(limit ?? DEFAULT_PURCHASE_HISTORY_PAGE_SIZE, 1), MAX_PURCHASE_HISTORY_PAGE_SIZE);
}

export function normalizePurchaseHistoryCursor(
  cursor?: PurchaseHistoryCursor | null,
): PurchaseHistoryCursor | null {
  if (!cursor || typeof cursor.sourceNameKey !== 'string' || cursor.sourceNameKey.length > 200) {
    return null;
  }
  const purchasedAt = new Date(cursor.purchasedAt);
  if (Number.isNaN(purchasedAt.getTime())) return null;
  // Preserva a representação armazenada no SQLite: a igualdade da segunda
  // parte do keyset é textual e formatos ISO equivalentes não são strings iguais.
  return { purchasedAt: cursor.purchasedAt, sourceNameKey: cursor.sourceNameKey };
}

// A consulta SQLite devolve no máximo limit+1 chaves. A chave extra apenas
// informa que existe outra página; as linhas da compra extra não são carregadas.
export function createPurchaseHistoryKeyWindow(
  keys: PurchaseHistoryKey[],
  requestedLimit?: number,
): { keys: PurchaseHistoryKey[]; nextCursor: PurchaseHistoryCursor | null } {
  const limit = normalizePurchaseHistoryLimit(requestedLimit);
  const pageKeys = keys.slice(0, limit);
  const last = keys.length > limit ? pageKeys.at(-1) : undefined;
  return {
    keys: pageKeys,
    nextCursor: last
      ? { purchasedAt: last.purchasedAt, sourceNameKey: last.sourceNameKey }
      : null,
  };
}

// Espelha a condição keyset do SQL e permite testar, sem SQLite nativo no
// runner Node, que datas iguais avançam pelo desempate do nome da lista.
export function isPurchaseHistoryKeyAfterCursor(
  key: PurchaseHistoryKey,
  cursor: PurchaseHistoryCursor,
): boolean {
  const keyTime = new Date(key.purchasedAt).getTime();
  const cursorTime = new Date(cursor.purchasedAt).getTime();
  return keyTime < cursorTime || (keyTime === cursorTime && key.sourceNameKey > cursor.sourceNameKey);
}

export function groupPurchaseHistoryRecords<T extends GroupablePurchaseHistoryRecord>(
  records: T[],
): GroupedPurchaseHistory<T>[] {
  const purchases: GroupedPurchaseHistory<T>[] = [];
  const byKey = new Map<string, GroupedPurchaseHistory<T>>();
  for (const record of records) {
    const key = `${record.purchasedAt}-${record.sourceListName ?? 'manual'}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.records.push(record);
    } else {
      const purchase = {
        key,
        purchasedAt: record.purchasedAt,
        sourceListName: record.sourceListName,
        records: [record],
      };
      purchases.push(purchase);
      byKey.set(key, purchase);
    }
  }
  return purchases;
}

export function mergeHistoryGroups<T extends { id: string }>(
  current: MergeableHistoryGroup<T>[],
  incoming: MergeableHistoryGroup<T>[],
): MergeableHistoryGroup<T>[] {
  const merged = current.map((group) => ({ ...group, items: [...group.items] }));
  const byTitle = new Map(merged.map((group) => [group.title, group]));
  for (const incomingGroup of incoming) {
    const existing = byTitle.get(incomingGroup.title);
    if (!existing) {
      const group = { ...incomingGroup, items: [...incomingGroup.items] };
      merged.push(group);
      byTitle.set(group.title, group);
      continue;
    }

    const existingIds = new Set(existing.items.map((item) => item.id));
    for (const item of incomingGroup.items) {
      if (!existingIds.has(item.id)) {
        existing.items.push(item);
        existingIds.add(item.id);
      }
    }
  }
  return merged;
}
