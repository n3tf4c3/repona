// @repona/core — lógica de domínio pura, sem dependências de framework.
// Compartilhada entre o app web (Next.js) e o app mobile (Expo).
export type {
  ProductStatus,
  InventoryStatus,
  ProductDTO,
  NewProductInput,
  ShoppingListDTO,
  ShoppingListItemDTO,
  PurchaseHistoryDTO,
} from "./contracts";
export { FIELD_LIMITS, MAX_PRICE_CENTS, CATEGORIAS, validateProductFields } from "./contracts";
export type { Categoria } from "./contracts";
export {
  isEmptyQuantity,
  getNextInventoryQuantity,
  getConsumedQuantity,
  normalizeQuantity,
  buildQuantityString,
  MAX_QUANTITY_VALUE,
} from "./inventory-quantity";
export type {
  ProductLike,
  InventoryAlert,
  InventoryAlertLevel,
  RebuySuggestion,
} from "./home-rules";
export { buildInventoryAlerts, buildRebuySuggestion } from "./home-rules";
export type {
  SyncProduct,
  SyncPurchase,
  SyncConsumption,
  SyncPrice,
  SyncSnapshot,
} from "./sync";
export type { ProductMatch, ProductMatchMaps } from "./sync";
export { productNameKey, eventKey, uuidv4, matchProduct, shouldApplyIncoming } from "./sync";
export type { PriceTrend, PriceSummary, PricePoint } from "./price";
export { summarizePrices } from "./price";
export type { ShoppingTotalLine, ShoppingTotalEstimate } from "./shopping-total";
export { estimateShoppingTotal } from "./shopping-total";
