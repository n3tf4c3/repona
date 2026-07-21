export type ProductSyncAlias = {
  oldSyncId: string;
  canonicalProductId: number;
};

export function aliasForFallbackProductMatch(input: {
  incomingSyncId?: string | null;
  canonicalSyncId: string;
  canonicalProductId: number;
  matchedBy: "syncId" | "barcode" | "name" | "none";
}): ProductSyncAlias | null {
  if (
    !input.incomingSyncId ||
    input.incomingSyncId === input.canonicalSyncId ||
    (input.matchedBy !== "barcode" && input.matchedBy !== "name")
  ) {
    return null;
  }
  return {
    oldSyncId: input.incomingSyncId,
    canonicalProductId: input.canonicalProductId,
  };
}

// Acrescenta identidades aposentadas ao mesmo índice usado pelo match normal.
// O Set separado permite que o chamador reconheça o tombstone e não deixe
// metadados antigos renomearem o produto canônico. (auditoria #86)
export function indexProductSyncAliases(
  idBySyncId: Map<string, number>,
  aliases: readonly ProductSyncAlias[]
): Set<string> {
  const retired = new Set<string>();
  for (const alias of aliases) {
    idBySyncId.set(alias.oldSyncId, alias.canonicalProductId);
    retired.add(alias.oldSyncId);
  }
  return retired;
}
