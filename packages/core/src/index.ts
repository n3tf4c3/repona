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
export {
  isEmptyQuantity,
  getNextInventoryQuantity,
  getConsumedQuantity,
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
export { productNameKey, eventKey } from "./sync";
export type { PriceTrend, PriceSummary, PricePoint } from "./price";
export { summarizePrices } from "./price";
export type { ShoppingTotalLine, ShoppingTotalEstimate } from "./shopping-total";
export { estimateShoppingTotal } from "./shopping-total";
