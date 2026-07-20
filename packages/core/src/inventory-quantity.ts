// Lógica pura de parsing/cálculo de quantidade de estoque ("1 un", "500 g").
// Compartilhada entre o backend do web e o mobile. Sem dependência de framework.
// Portado de apps/mobile/src/storage/inventory.ts (comportamento idêntico).

// Forma canônica da quantidade para COMPARAÇÃO/dedupe (não altera o que é
// exibido): tira espaços das pontas, colapsa espaços internos e ignora caixa.
// Assim "1 un", "1  Un" e "1 UN" viram a mesma chave e param de acumular no
// histórico. Não unifica sinônimos de unidade nem "1un" (sem espaço) — isso
// exigiria parsing. (auditoria 2026-06-09 #4)
export function normalizeQuantity(quantity: string): string {
  return quantity.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

// Maior valor numérico aceito numa quantidade digitada. Limite doméstico que
// também evita que o número vire notação científica ("1e+21") no String(num) —
// formato que o validador de quantidade do web rejeita. (auditoria #30)
export const MAX_QUANTITY_VALUE = 1_000_000;

// Monta a string canônica de quantidade ("0,8 kg") a partir do valor digitado e
// da unidade, validando para casar com o que o web aceita (decimal com vírgula,
// sem notação científica). Devolve null se inválida. Fonte única dos modais do
// mobile, no lugar de montar "${num} unidade" à mão. (auditoria #30)
export function buildQuantityString(value: string, unit: string): string | null {
  const num = Number(value.replace(",", "."));
  if (!Number.isFinite(num) || num <= 0 || num > MAX_QUANTITY_VALUE) return null;
  const unidade = unit.trim() || "un";
  // num <= 1e6 nunca usa notação científica em String(num).
  const formatado = String(num).replace(".", ",");
  return `${formatado} ${unidade}`;
}

// Canonicaliza uma quantidade recebida pelo protocolo de sync. O parser de
// estoque/consumo assume que a string começa com um número; valores fora do
// formato ("", "abc") cairiam em defaults silenciosos e produziriam status,
// totais ou eventos incorretos. Aqui um valor inválido vira o fallback explícito
// em vez de rejeitar o snapshot INTEIRO da casa (mesma tolerância do enum de
// categoria). Web e mobile já geram quantidades válidas; isto fecha a brecha de
// um cliente modificado/corrompido. (auditoria #75)
export function canonicalQuantity(raw: string, fallback: string): string {
  const t = raw.trim();
  if (!/^\d+(?:[.,]\d+)?/.test(t)) return fallback;
  return t;
}

export function isEmptyQuantity(quantity: string): boolean {
  const match = quantity.match(/^(\d+(?:[.,]\d+)?)/);

  if (!match) {
    return false;
  }

  return Number(match[1].replace(",", ".")) <= 0;
}

export function getNextInventoryQuantity(quantity: string, direction: 1 | -1): string {
  const match = quantity.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);

  if (!match) {
    return direction > 0 ? "1 un" : "0 un";
  }

  const currentValue = Number(match[1].replace(",", "."));
  const unit = match[2].trim() || "un";
  const step = unit === "g" ? 100 : 1;
  const nextValue = Math.max(0, currentValue + direction * step);
  const formattedValue = Number.isInteger(nextValue)
    ? `${nextValue}`
    : `${nextValue.toFixed(1).replace(".", ",")}`;

  return `${formattedValue} ${unit}`;
}

export function getConsumedQuantity(quantity: string): string {
  const match = quantity.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  const currentValue = match ? Number(match[1].replace(",", ".")) : 1;
  const unit = match?.[2].trim() || "un";
  const step = unit === "g" ? 100 : 1;
  const consumedValue = Math.min(currentValue, step);
  const formattedValue = Number.isInteger(consumedValue)
    ? `${consumedValue}`
    : `${consumedValue.toFixed(1).replace(".", ",")}`;

  return `${formattedValue} ${unit}`;
}
