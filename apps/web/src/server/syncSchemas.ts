import { z } from "zod";
import { CATEGORIAS, FIELD_LIMITS, MAX_PRICE_CENTS, canonicalQuantity } from "@repona/core";

const productSchema = z.object({
  syncId: z.string().uuid().optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  metadataUpdatedAt: z.string().datetime({ offset: true }).optional(),
  inventoryUpdatedAt: z.string().datetime({ offset: true }).optional(),
  name: z.string().trim().min(1).max(FIELD_LIMITS.name),
  category: z.enum(CATEGORIAS).catch("Mercearia"),
  brand: z.string().max(FIELD_LIMITS.brand).nullish().default(null),
  barcode: z
    .string()
    .max(FIELD_LIMITS.barcode)
    .nullable()
    .transform((value) => (value && value.trim() ? value.trim() : null)),
  purchaseCount: z.number().int().min(0),
  status: z.enum(["active", "missing"]),
  alertThreshold: z.string().max(FIELD_LIMITS.alertThreshold).nullable(),
  inventoryQuantity: z
    .string()
    .max(FIELD_LIMITS.quantity)
    .transform((value) => canonicalQuantity(value, "0 un", { allowZero: true })),
  inventoryStatus: z.enum(["in_stock", "missing"]),
  archived: z.boolean().optional().default(false),
  occasional: z.boolean().optional().default(false),
});

const purchaseSchema = z.object({
  syncId: z.string().uuid().optional(),
  productSyncId: z.string().uuid().optional(),
  productName: z.string().trim().min(1).max(FIELD_LIMITS.name),
  quantity: z
    .string()
    .max(FIELD_LIMITS.quantity)
    .transform((value) => canonicalQuantity(value, "1 un")),
  purchasedAt: z.string().datetime({ offset: true }),
  sourceListName: z.string().max(120).nullish(),
  deleted: z.boolean().optional().default(false),
  updatedAt: z.string().datetime({ offset: true }).nullish(),
});

const consumptionSchema = z
  .object({
    syncId: z.string().uuid().optional(),
    productSyncId: z.string().uuid().optional(),
    eventType: z.enum(["consumed", "set"]).optional().default("consumed"),
    productName: z.string().trim().min(1).max(FIELD_LIMITS.name),
    quantity: z.string().max(FIELD_LIMITS.quantity),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .transform((event) => ({
    ...event,
    quantity: canonicalQuantity(
      event.quantity,
      event.eventType === "set" ? "0 un" : "1 un",
      { allowZero: event.eventType === "set" }
    ),
  }));

const priceSchema = z.object({
  syncId: z.string().uuid().optional(),
  productSyncId: z.string().uuid().optional(),
  productName: z.string().trim().min(1).max(FIELD_LIMITS.name),
  priceCents: z.number().int().min(1).max(MAX_PRICE_CENTS),
  recordedAt: z.string().datetime({ offset: true }),
});

const listItemSchema = z.object({
  productSyncId: z.string().uuid().optional(),
  productName: z.string().trim().min(1).max(FIELD_LIMITS.name),
  quantity: z
    .string()
    .max(FIELD_LIMITS.quantity)
    .transform((value) => canonicalQuantity(value, "1 un")),
  checked: z.boolean(),
  deleted: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }),
});

// O contrato legado continua aceitando os tetos antigos durante o rollout do
// protocolo paginado. O endpoint v2 reutiliza os mesmos itens, mas impõe o teto
// de custo menor por página depois do parse. (#55/#67/#74)
export const snapshotSchema = z.object({
  products: z.array(productSchema).max(2_000),
  purchases: z.array(purchaseSchema).max(10_000),
  consumptions: z.array(consumptionSchema).max(10_000),
  prices: z.array(priceSchema).max(10_000),
  listItems: z.array(listItemSchema).max(2_000).optional().default([]),
});

export type ParsedSyncSnapshot = z.infer<typeof snapshotSchema>;

// Versão do app é telemetria operacional, não credencial. Mantemos um
// formato curto e estrito para que um header arbitrário não polua os logs.
const syncClientVersionSchema = z.string().trim().min(1).max(32).regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);

export function parseSyncClientVersion(value: string | null): string | null {
  const parsed = syncClientVersionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function syncTargetMatches(actualCasaId: number, expectedCasaId?: number): boolean {
  return expectedCasaId === undefined || expectedCasaId === actualCasaId;
}
