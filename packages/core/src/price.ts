// Resumo do histórico de preços de um produto, para apoiar a decisão de manter
// (ou não) o item na lista de compras. Preços em centavos (inteiro).

export type PriceTrend = "up" | "down" | "flat";

export type PriceSummary = {
  count: number;
  lastCents: number;
  previousCents: number | null;
  minCents: number;
  maxCents: number;
  avgCents: number;
  trend: PriceTrend; // último vs. anterior
  trendPercentage: number | null; // % de alteração em relação ao preço anterior
};

export type PricePoint = { priceCents: number; recordedAt: string };

// Recebe os pontos de preço (qualquer ordem) e devolve o resumo, considerando
// os mais recentes primeiro. Retorna null quando não há preços.
export function summarizePrices(points: PricePoint[]): PriceSummary | null {
  if (points.length === 0) return null;

  const ordenados = [...points].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const cents = ordenados.map((p) => p.priceCents);

  const lastCents = cents[0];
  const previousCents = cents.length > 1 ? cents[1] : null;
  const minCents = Math.min(...cents);
  const maxCents = Math.max(...cents);
  const avgCents = Math.round(cents.reduce((sum, val) => sum + val, 0) / cents.length);

  let trendPercentage: number | null = null;
  if (previousCents !== null && previousCents > 0) {
    trendPercentage = Math.round(((lastCents - previousCents) / previousCents) * 100);
  }

  const trend: PriceTrend =
    previousCents === null || lastCents === previousCents
      ? "flat"
      : lastCents > previousCents
        ? "up"
        : "down";

  return {
    count: cents.length,
    lastCents,
    previousCents,
    minCents,
    maxCents,
    avgCents,
    trend,
    trendPercentage,
  };
}
