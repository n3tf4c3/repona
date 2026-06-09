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
