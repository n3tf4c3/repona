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
