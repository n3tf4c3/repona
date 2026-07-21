export type ProductSyncAlias = {
  oldSyncId: string;
  canonicalProductId: number;
};

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
