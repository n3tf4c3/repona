// Lógica pura de parsing/cálculo de quantidade de estoque ("1 un", "500 g").
// Compartilhada entre o backend do web e o mobile. Sem dependência de framework.
// Portado de apps/mobile/src/storage/inventory.ts (comportamento idêntico).

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
