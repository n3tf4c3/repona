function millis(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function escolherEstadoMaisRecente(
  canonical,
  duplicate,
  { tombstoneWinsTie = false } = {}
) {
  if (!canonical) return duplicate ? { source: "duplicate", row: duplicate } : null;
  if (!duplicate) return { source: "canonical", row: canonical };

  const canonicalTime = millis(canonical.updated_at);
  const duplicateTime = millis(duplicate.updated_at);
  if (duplicateTime > canonicalTime) return { source: "duplicate", row: duplicate };
  if (canonicalTime > duplicateTime) return { source: "canonical", row: canonical };

  if (tombstoneWinsTie && Boolean(canonical.deleted) !== Boolean(duplicate.deleted)) {
    return duplicate.deleted
      ? { source: "duplicate", row: duplicate }
      : { source: "canonical", row: canonical };
  }
  return { source: "canonical", row: canonical };
}

export function planejarItensLista(rows, canonicalId, duplicateId) {
  const byList = new Map();
  for (const row of rows) {
    const current = byList.get(row.shopping_list_id) ?? {
      listId: row.shopping_list_id,
      listName: row.list_name,
      listStatus: row.list_status,
      canonical: null,
      duplicate: null,
    };
    if (row.product_id === canonicalId) current.canonical = row;
    if (row.product_id === duplicateId) current.duplicate = row;
    byList.set(row.shopping_list_id, current);
  }

  return [...byList.values()]
    .sort((a, b) => a.listId - b.listId)
    .map((entry) => {
      const winner = escolherEstadoMaisRecente(entry.canonical, entry.duplicate, {
        tombstoneWinsTie: true,
      });
      return {
        ...entry,
        action:
          entry.canonical && entry.duplicate
            ? "reconcile"
            : entry.duplicate
              ? "move"
              : "keep",
        winnerSource: winner?.source ?? null,
        result: winner?.row ?? null,
      };
    });
}

export function planejarEstoque(rows, canonicalId, duplicateId) {
  const canonical = rows.find((row) => row.product_id === canonicalId) ?? null;
  const duplicate = rows.find((row) => row.product_id === duplicateId) ?? null;
  const winner = escolherEstadoMaisRecente(canonical, duplicate);
  return {
    canonical,
    duplicate,
    action:
      canonical && duplicate ? "reconcile" : duplicate ? "move" : canonical ? "keep" : "none",
    winnerSource: winner?.source ?? null,
    result: winner?.row ?? null,
    emitsSetEvent: Boolean(winner),
  };
}

// UUID é identidade, não conteúdo. Dois eventos com mesma quantidade e segundo,
// mas UUIDs distintos, são preservados; somente uma eventual repetição do mesmo
// UUID representa replay. Linhas legadas sem UUID recebem um antes do move.
export function resumirEventos(rows, canonicalId, duplicateId) {
  const relevant = rows.filter(
    (row) => row.product_id === canonicalId || row.product_id === duplicateId
  );
  const seen = new Set();
  let stableIdReplays = 0;
  for (const row of relevant) {
    if (!row.sync_id) continue;
    if (seen.has(row.sync_id)) stableIdReplays += 1;
    else seen.add(row.sync_id);
  }
  return {
    canonical: relevant.filter((row) => row.product_id === canonicalId).length,
    duplicate: relevant.filter((row) => row.product_id === duplicateId).length,
    legacyIdsToAssign: relevant.filter((row) => !row.sync_id).length,
    stableIdReplays,
    preserved: relevant.length - stableIdReplays,
  };
}

export function construirPlanoMerge({
  canonical,
  duplicate,
  purchases,
  prices,
  inventoryEvents,
  inventoryItems,
  listItems,
  aliasesPointingToDuplicate,
}) {
  const purchaseSummary = resumirEventos(purchases, canonical.id, duplicate.id);
  const priceSummary = resumirEventos(prices, canonical.id, duplicate.id);
  const inventoryEventSummary = resumirEventos(
    inventoryEvents,
    canonical.id,
    duplicate.id
  );
  const listPlan = planejarItensLista(listItems, canonical.id, duplicate.id);
  const inventoryPlan = planejarEstoque(inventoryItems, canonical.id, duplicate.id);

  return {
    canonical,
    duplicate,
    purchases: {
      ...purchaseSummary,
      live: purchases.filter((row) => !row.deleted).length,
      tombstones: purchases.filter((row) => row.deleted).length,
      finalPurchaseCount: purchases.filter((row) => !row.deleted).length,
    },
    prices: priceSummary,
    inventoryEvents: inventoryEventSummary,
    inventory: inventoryPlan,
    listItems: {
      rows: listItems.length,
      moves: listPlan.filter((entry) => entry.action === "move").length,
      collisions: listPlan.filter((entry) => entry.action === "reconcile").length,
      decisions: listPlan,
    },
    aliases: {
      repoint: aliasesPointingToDuplicate,
      create: { oldSyncId: duplicate.sync_id, canonicalProductId: canonical.id },
    },
  };
}
