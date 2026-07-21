import { productNameKey } from "@repona/core";

export type ProductNameKeySourceRow = {
  id: number | string;
  casaId: number | string;
  name: string;
  storedNameKey: string | null;
};

export type ProductNameKeyTargetRow = {
  id: string;
  nameKey: string;
};

export type ProductNameKeyAnalysis = {
  totalRows: number;
  rowsNeedingUpdate: number;
  collisionGroups: number;
  collidingRows: number;
  targetRows: ProductNameKeyTargetRow[];
};

export type ProductNameKeyPreflightSummary = Omit<ProductNameKeyAnalysis, "targetRows"> & {
  columnExists: boolean;
  columnReady: boolean;
  indexReady: boolean;
  legacyIndexExists: boolean;
};

/**
 * Calcula as chaves no mesmo runtime JavaScript usado pelo core/mobile.
 *
 * As chaves e os nomes permanecem apenas na memoria: o resumo publico contem
 * somente contagens, para que o CLI possa ser usado em logs operacionais sem
 * expor dados de dominio.
 */
export function analyzeProductNameKeys(
  rows: readonly ProductNameKeySourceRow[]
): ProductNameKeyAnalysis {
  const groupedIds = new Map<string, string[]>();
  const targetRows: ProductNameKeyTargetRow[] = [];
  let rowsNeedingUpdate = 0;

  for (const row of rows) {
    const id = String(row.id);
    const casaId = String(row.casaId);
    const nameKey = productNameKey(row.name);
    targetRows.push({ id, nameKey });

    if (row.storedNameKey !== nameKey) rowsNeedingUpdate += 1;

    // JSON evita ambiguidades entre a casa e uma chave que contenha qualquer
    // separador escolhido manualmente. O valor nunca sai deste modulo.
    const groupKey = JSON.stringify([casaId, nameKey]);
    const ids = groupedIds.get(groupKey) ?? [];
    ids.push(id);
    groupedIds.set(groupKey, ids);
  }

  const collisions = [...groupedIds.values()].filter((ids) => ids.length > 1);
  return {
    totalRows: rows.length,
    rowsNeedingUpdate,
    collisionGroups: collisions.length,
    collidingRows: collisions.reduce((total, ids) => total + ids.length, 0),
    targetRows,
  };
}

export function toProductNameKeyPreflightSummary(
  analysis: ProductNameKeyAnalysis,
  structure: {
    columnExists: boolean;
    columnReady: boolean;
    indexReady: boolean;
    legacyIndexExists: boolean;
  }
): ProductNameKeyPreflightSummary {
  return {
    totalRows: analysis.totalRows,
    rowsNeedingUpdate: analysis.rowsNeedingUpdate,
    collisionGroups: analysis.collisionGroups,
    collidingRows: analysis.collidingRows,
    ...structure,
  };
}

export function formatProductNameKeyPreflight(summary: ProductNameKeyPreflightSummary): string {
  return [
    `Produtos analisados: ${summary.totalRows}`,
    `Chaves a preencher/corrigir: ${summary.rowsNeedingUpdate}`,
    `Grupos em colisao: ${summary.collisionGroups}`,
    `Linhas em colisao: ${summary.collidingRows}`,
    `Coluna name_key: ${summary.columnReady ? "pronta" : summary.columnExists ? "incompleta" : "ausente"}`,
    `Indice unico persistido: ${summary.indexReady ? "pronto" : "pendente"}`,
    `Indice lower legado: ${summary.legacyIndexExists ? "presente" : "ausente"}`,
  ].join("\n");
}
