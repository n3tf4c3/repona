import {
  CATEGORIAS,
  FIELD_LIMITS,
  MAX_PRICE_CENTS,
  canonicalQuantity,
  type SyncSnapshot,
} from '@repona/core';

// Mantidos alinhados aos limites do endpoint /api/sync. A resposta ainda passa
// por esta fronteira antes de qualquer loop/INSERT do applySnapshot.
const MAX_PRODUCTS = 2_000;
const MAX_EVENTS = 10_000;
const MAX_LIST_ITEMS = 2_000;
const MAX_SOURCE_LIST_NAME_LENGTH = 120;

const PRODUCT_STATUSES = ['active', 'missing'] as const;
const INVENTORY_STATUSES = ['in_stock', 'missing'] as const;
const INVALID_QUANTITY = '__INVALID_SYNC_QUANTITY__';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isBoundedString(value: unknown, max: number, required = false): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    (!required || value.trim().length > 0)
  );
}

function isOptionalUuid(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && UUID_RE.test(value));
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_RE.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1] &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}

function isOptionalIsoDate(value: unknown, nullable = false): boolean {
  return value === undefined || (nullable && value === null) || isIsoDate(value);
}

function isEnumValue<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value);
}

function isQuantity(value: unknown, allowZero = false): value is string {
  return (
    isBoundedString(value, FIELD_LIMITS.quantity, true) &&
    canonicalQuantity(value, INVALID_QUANTITY, { allowZero }) !== INVALID_QUANTITY
  );
}

function validProduct(product: unknown): boolean {
  if (!isRecord(product)) return false;
  return (
    isOptionalUuid(product.syncId) &&
    isOptionalIsoDate(product.updatedAt) &&
    isOptionalIsoDate(product.metadataUpdatedAt) &&
    isOptionalIsoDate(product.inventoryUpdatedAt) &&
    isBoundedString(product.name, FIELD_LIMITS.name, true) &&
    isEnumValue(product.category, CATEGORIAS) &&
    (product.brand === undefined ||
      product.brand === null ||
      isBoundedString(product.brand, FIELD_LIMITS.brand)) &&
    (product.barcode === null || isBoundedString(product.barcode, FIELD_LIMITS.barcode)) &&
    Number.isSafeInteger(product.purchaseCount) &&
    (product.purchaseCount as number) >= 0 &&
    isEnumValue(product.status, PRODUCT_STATUSES) &&
    (product.alertThreshold === null ||
      isBoundedString(product.alertThreshold, FIELD_LIMITS.alertThreshold)) &&
    isQuantity(product.inventoryQuantity, true) &&
    isEnumValue(product.inventoryStatus, INVENTORY_STATUSES) &&
    isBoolean(product.archived) &&
    isBoolean(product.occasional)
  );
}

function validPurchase(purchase: unknown): boolean {
  if (!isRecord(purchase)) return false;
  return (
    isOptionalUuid(purchase.syncId) &&
    isOptionalUuid(purchase.productSyncId) &&
    isBoundedString(purchase.productName, FIELD_LIMITS.name, true) &&
    isQuantity(purchase.quantity) &&
    isIsoDate(purchase.purchasedAt) &&
    (purchase.sourceListName === undefined ||
      purchase.sourceListName === null ||
      isBoundedString(purchase.sourceListName, MAX_SOURCE_LIST_NAME_LENGTH)) &&
    (purchase.deleted === undefined || isBoolean(purchase.deleted)) &&
    isOptionalIsoDate(purchase.updatedAt, true)
  );
}

function validConsumption(consumption: unknown): boolean {
  if (!isRecord(consumption)) return false;
  return (
    isOptionalUuid(consumption.syncId) &&
    isOptionalUuid(consumption.productSyncId) &&
    (consumption.eventType === undefined ||
      consumption.eventType === 'consumed' ||
      consumption.eventType === 'set') &&
    isBoundedString(consumption.productName, FIELD_LIMITS.name, true) &&
    isQuantity(consumption.quantity, consumption.eventType === 'set') &&
    isIsoDate(consumption.occurredAt)
  );
}

function validPrice(price: unknown): boolean {
  if (!isRecord(price)) return false;
  return (
    isOptionalUuid(price.syncId) &&
    isOptionalUuid(price.productSyncId) &&
    isBoundedString(price.productName, FIELD_LIMITS.name, true) &&
    Number.isSafeInteger(price.priceCents) &&
    (price.priceCents as number) >= 1 &&
    (price.priceCents as number) <= MAX_PRICE_CENTS &&
    isIsoDate(price.recordedAt)
  );
}

function validListItem(item: unknown): boolean {
  if (!isRecord(item)) return false;
  return (
    isOptionalUuid(item.productSyncId) &&
    isBoundedString(item.productName, FIELD_LIMITS.name, true) &&
    isQuantity(item.quantity) &&
    isBoolean(item.checked) &&
    isBoolean(item.deleted) &&
    isIsoDate(item.updatedAt)
  );
}

function validArray(value: unknown, max: number, validate: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= max && value.every(validate);
}

// Fronteira pura entre JSON remoto e applySnapshot. Um único campo inválido
// rejeita a resposta inteira antes de abrir/escrever o SQLite.
export function parseSyncSnapshot(raw: unknown): SyncSnapshot | null {
  if (!isRecord(raw)) return null;
  if (!validArray(raw.products, MAX_PRODUCTS, validProduct)) return null;
  if (!validArray(raw.purchases, MAX_EVENTS, validPurchase)) return null;
  if (!validArray(raw.consumptions, MAX_EVENTS, validConsumption)) return null;
  if (!validArray(raw.prices, MAX_EVENTS, validPrice)) return null;
  if (raw.listItems !== undefined && !validArray(raw.listItems, MAX_LIST_ITEMS, validListItem)) {
    return null;
  }
  return raw as unknown as SyncSnapshot;
}
