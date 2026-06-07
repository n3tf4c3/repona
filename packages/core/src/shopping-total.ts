// Estimativa do total de uma lista de compras. Cada linha tem o último preço
// conhecido do produto (em centavos) e a quantidade digitada ("3 un", "0,65 kg",
// "500 g"). O cálculo é sempre preço × quantidade; gramas viram quilos, pois o
// preço de itens por peso é entendido como por kg. Linhas sem preço ficam de fora.

export type ShoppingTotalLine = { priceCents: number | null; quantity: string };

export type ShoppingTotalEstimate = {
  totalCents: number;
  pricedCount: number;
  missingCount: number;
};

export function estimateShoppingTotal(lines: ShoppingTotalLine[]): ShoppingTotalEstimate {
  let totalCents = 0;
  let pricedCount = 0;
  let missingCount = 0;

  for (const line of lines) {
    if (line.priceCents == null) {
      missingCount += 1;
      continue;
    }
    totalCents += line.priceCents * quantityMultiplier(line.quantity);
    pricedCount += 1;
  }

  return { totalCents: Math.round(totalCents), pricedCount, missingCount };
}

function quantityMultiplier(quantity: string): number {
  const match = quantity.trim().match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]*)/);
  if (!match) return 1;

  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return 1;

  const unit = match[2].toLowerCase();
  if (unit === "g") return value / 1000; // preço de peso é por kg
  return value; // un, kg, ml, l, vazio
}
