import type { ShoppingListItemDTO } from "@repona/core";

// Cores por categoria (referência leve da paleta do mobile, apps/mobile/src/theme.ts).
const CORES: Record<string, string> = {
  Hortifrúti: "#2E8B57",
  Laticínios: "#E0913B",
  Bebidas: "#E0913B",
  Mercearia: "#6471DE",
  Limpeza: "#6471DE",
};

const COR_PADRAO = "#2E8B57";

export function corDaCategoria(categoria: string): string {
  return CORES[categoria] ?? COR_PADRAO;
}

export const CATEGORIAS = ["Hortifrúti", "Laticínios", "Mercearia", "Bebidas", "Limpeza"] as const;

export type GrupoItens = {
  category: string;
  color: string;
  items: ShoppingListItemDTO[];
};

// Agrupa itens da lista por categoria (porte de groupShoppingItems do mobile).
export function agruparPorCategoria(items: ShoppingListItemDTO[]): GrupoItens[] {
  const mapa = new Map<string, ShoppingListItemDTO[]>();
  for (const item of items) {
    const lista = mapa.get(item.category) ?? [];
    lista.push(item);
    mapa.set(item.category, lista);
  }
  return Array.from(mapa.entries()).map(([category, grupo]) => ({
    category,
    color: corDaCategoria(category),
    items: grupo,
  }));
}
