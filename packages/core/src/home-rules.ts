// Regras puras da tela Início: alertas de estoque e sugestão de recompra.
// Portado de apps/mobile/App.tsx (comportamento idêntico), operando sobre ProductDTO.
import type { ProductDTO } from "./contracts";

export type InventoryAlertLevel = "missing" | "low";

// Conjunto mínimo de campos que as regras leem. ProductDTO (web) e Product
// (mobile, enriquecido com ícone/cores) satisfazem este formato, então cada app
// passa o seu tipo e o recebe de volta nos alertas/sugestões (genérico em P).
export type ProductLike = {
  id?: number;
  name: string;
  purchaseCount?: number;
  consumptionCount?: number;
  inventoryQuantity?: string;
  inventoryStatus?: "in_stock" | "missing";
  alertThreshold?: string | null;
  lastConsumedAt?: string | null;
  // Compra eventual (ex.: churrasco): fica fora de alertas e sugestão de recompra.
  occasional?: boolean;
};

export type InventoryAlert<P extends ProductLike = ProductDTO> = {
  id: string;
  product: P;
  level: InventoryAlertLevel;
  label: string;
  description: string;
};

export type RebuySuggestion<P extends ProductLike = ProductDTO> = {
  product: P;
  title: string;
  description: string;
  badge: string;
  score: number;
};

type ParsedQuantity = { value: number; unit: string };

function parseInventoryQuantity(quantity?: string | null): ParsedQuantity | null {
  const match = quantity?.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!match) return null;
  return {
    value: Number(match[1].replace(",", ".")),
    unit: match[2].trim().toLocaleLowerCase("pt-BR") || "un",
  };
}

function isLowInventoryQuantity(quantity: ParsedQuantity, threshold: ParsedQuantity | null): boolean {
  if (quantity.value <= 0) return false;
  if (threshold && threshold.unit === quantity.unit) return quantity.value <= threshold.value;
  if (quantity.unit === "g") return quantity.value <= 500;
  if (quantity.unit === "kg") return quantity.value <= 1;
  return quantity.value <= 1;
}

function getDateTime(value?: string | null): number {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getDayDifference(date: Date, otherDate: Date): number {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const b = new Date(otherDate.getFullYear(), otherDate.getMonth(), otherDate.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

function getShortMonth(month: number): string {
  return (
    ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][month] ??
    "data salva"
  );
}

function formatRelativeConsumptionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "registrado";
  const diffDays = getDayDifference(date, new Date());
  if (diffDays === 0) return "hoje";
  if (diffDays === 1) return "ontem";
  if (diffDays > 1 && diffDays <= 6) return `há ${diffDays} dias`;
  return `${date.getDate()} ${getShortMonth(date.getMonth())}`;
}

function getRecentConsumptionScore(value?: string | null): number {
  const consumedAt = getDateTime(value);
  if (consumedAt === 0) return 0;
  const diffDays = getDayDifference(new Date(consumedAt), new Date());
  if (diffDays <= 1) return 8;
  if (diffDays <= 7) return 4;
  return 1;
}

function descricaoComConsumo(product: ProductLike, base: string): string {
  if (product.lastConsumedAt) {
    return `${base} Último consumo: ${formatRelativeConsumptionDate(product.lastConsumedAt)}.`;
  }
  return base;
}

// ---- Alertas de estoque ----

export function buildInventoryAlerts<P extends ProductLike>(products: P[]): InventoryAlert<P>[] {
  const alerts = products.reduce<InventoryAlert<P>[]>((items, product) => {
    if (product.occasional) return items;
    if (product.inventoryStatus === "missing") {
      items.push({
        id: `${product.id}-missing`,
        product,
        level: "missing",
        label: "Falta",
        description: descricaoComConsumo(product, "Sem estoque registrado em casa."),
      });
      return items;
    }

    const quantity = parseInventoryQuantity(product.inventoryQuantity);
    const threshold = parseInventoryQuantity(product.alertThreshold);

    if (quantity && isLowInventoryQuantity(quantity, threshold)) {
      const base =
        threshold && threshold.unit === quantity.unit
          ? `Restam ${product.inventoryQuantity} em casa. Limiar: ${product.alertThreshold}.`
          : `Restam ${product.inventoryQuantity} em casa.`;
      items.push({
        id: `${product.id}-low`,
        product,
        level: "low",
        label: "Baixo",
        description: descricaoComConsumo(product, base),
      });
    }
    return items;
  }, []);

  return alerts.sort(compareInventoryAlerts);
}

function compareInventoryAlerts<P extends ProductLike>(
  first: InventoryAlert<P>,
  second: InventoryAlert<P>
): number {
  const rank = (level: InventoryAlertLevel) => (level === "missing" ? 0 : 1);
  const levelDiff = rank(first.level) - rank(second.level);
  if (levelDiff !== 0) return levelDiff;
  const f = getDateTime(first.product.lastConsumedAt);
  const s = getDateTime(second.product.lastConsumedAt);
  if (f !== s) return s - f;
  return (second.product.consumptionCount ?? 0) - (first.product.consumptionCount ?? 0);
}

// ---- Sugestão de recompra ----

export function buildRebuySuggestion<P extends ProductLike>(
  products: P[],
  listedProductIds: Iterable<number>
): RebuySuggestion<P> | null {
  const listed = new Set(listedProductIds);
  const suggestions = products.reduce<RebuySuggestion<P>[]>((items, product) => {
    if (product.occasional) return items;
    if (product.id !== undefined && listed.has(product.id)) return items;
    const suggestion = getProductRebuySuggestion(product);
    if (suggestion) items.push(suggestion);
    return items;
  }, []);

  suggestions.sort((a, b) => b.score - a.score);
  return suggestions[0] ?? null;
}

function getProductRebuySuggestion<P extends ProductLike>(product: P): RebuySuggestion<P> | null {
  const purchaseCount = product.purchaseCount ?? 0;
  const consumptionCount = product.consumptionCount ?? 0;
  const quantity = parseInventoryQuantity(product.inventoryQuantity);
  const threshold = parseInventoryQuantity(product.alertThreshold);
  const isLowStock = Boolean(quantity && isLowInventoryQuantity(quantity, threshold));
  const recente = getRecentConsumptionScore(product.lastConsumedAt);

  if (product.inventoryStatus === "missing") {
    return {
      product,
      title: `Repor ${product.name}`,
      description: descricaoComConsumo(product, "Está em falta no estoque da casa."),
      badge: "Reposição urgente",
      score: 120 + purchaseCount + consumptionCount * 2 + recente,
    };
  }

  if (isLowStock) {
    return {
      product,
      title: `Comprar ${product.name}`,
      description: descricaoComConsumo(product, `Estoque baixo: ${product.inventoryQuantity}.`),
      badge: "Estoque baixo",
      score: 90 + purchaseCount + consumptionCount * 2 + recente,
    };
  }

  if (purchaseCount >= 5 || consumptionCount >= 2) {
    return {
      product,
      title: `${product.name} costuma voltar para a lista`,
      description: descricaoComConsumo(product, `${purchaseCount} compras registradas.`),
      badge: "Recorrente",
      score: 40 + purchaseCount + consumptionCount * 2 + recente,
    };
  }

  return null;
}
