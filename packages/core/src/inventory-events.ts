export type InventorySyncEvent = {
  syncId?: string | null;
  eventType?: "consumed" | "set";
  quantity: string;
  occurredAt: string;
};

type ParsedQuantity = { value: number; unit: string };

function parseQuantity(quantity: string): ParsedQuantity | null {
  const match = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(quantity.trim());
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return { value, unit: match[2].trim() || "un" };
}

function formatQuantity(value: number, unit: string): string {
  const safe = Math.max(0, value);
  const formatted = Number.isInteger(safe)
    ? String(safe)
    : safe.toFixed(3).replace(/0+$/, "").replace(".", ",");
  return `${formatted} ${unit}`;
}

export function subtractInventoryQuantity(current: string, consumed: string): string {
  const base = parseQuantity(current);
  const delta = parseQuantity(consumed);
  if (
    !base ||
    !delta ||
    base.unit.toLocaleLowerCase("pt-BR") !== delta.unit.toLocaleLowerCase("pt-BR")
  ) {
    return current;
  }
  return formatQuantity(base.value - delta.value, base.unit);
}

function orderKey(event: InventorySyncEvent): string | null {
  const ms = new Date(event.occurredAt).getTime();
  if (Number.isNaN(ms)) return null;
  return `${String(ms).padStart(16, "0")}|${event.syncId ?? ""}`;
}

// Materializa o saldo a partir do último evento absoluto (`set`) e de todos os
// deltas posteriores. UUIDs repetidos são ignorados; UUIDs distintos com mesmo
// conteúdo são dois consumos legítimos. O resultado independe da ordem de
// chegada dos devices. (auditoria #72/#73)
export function deriveInventoryQuantity(
  events: InventorySyncEvent[],
  fallback: string
): string {
  const seen = new Set<string>();
  const ordered = events
    .filter((event) => {
      if (!event.syncId) return true;
      if (seen.has(event.syncId)) return false;
      seen.add(event.syncId);
      return true;
    })
    .map((event) => ({ event, key: orderKey(event) }))
    .filter((entry): entry is { event: InventorySyncEvent; key: string } => entry.key !== null)
    .sort((a, b) => a.key.localeCompare(b.key));

  let quantity = fallback;
  let hasBaseline = false;
  for (const { event } of ordered) {
    if (event.eventType === "set") {
      quantity = event.quantity;
      hasBaseline = true;
    } else if (hasBaseline) {
      quantity = subtractInventoryQuantity(quantity, event.quantity);
    }
  }
  return quantity;
}

