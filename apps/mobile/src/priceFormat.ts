// Preços trafegam em centavos (inteiro). Aqui ficam só formatação/parse para a
// UI do app.

export function formatCentsBRL(cents: number): string {
  const valor = (cents / 100).toFixed(2).replace('.', ',');
  return `R$ ${valor}`;
}

// Converte o texto digitado ("8,90", "8.90", "12") em centavos.
// Retorna null se não for um valor positivo válido.
export function parsePriceToCents(text: string): number | null {
  const limpo = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!limpo) return null;
  const valor = Number(limpo);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return Math.round(valor * 100);
}
