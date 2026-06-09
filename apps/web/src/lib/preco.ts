// Preços trafegam em centavos (inteiro). Formatação BRL para a UI do web
// (espelha apps/mobile/src/priceFormat.ts).
export function formatCentsBRL(cents: number): string {
  const valor = (cents / 100).toFixed(2).replace(".", ",");
  return `R$ ${valor}`;
}
