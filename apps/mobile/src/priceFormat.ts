// Preços trafegam em centavos (inteiro). Aqui ficam só formatação/parse para a
// UI do app.
import { MAX_PRICE_CENTS } from '@repona/core';

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
  const cents = Math.round(valor * 100);
  // Acima do teto do sync o preço travaria o snapshot inteiro da casa. (auditoria #29)
  if (cents > MAX_PRICE_CENTS) return null;
  return cents;
}
