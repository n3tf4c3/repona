// Contratos (DTOs) compartilhados entre o backend do web e o cliente mobile.
// Definição canônica única: só formatos de dados, sem dependência de framework
// (nada de ícones do Expo, SQLite ou React) — coerente com o caráter puro do
// @repona/core. Derivados dos storage records do mobile (apps/mobile/src/storage).

export type ProductStatus = "active" | "missing";
export type InventoryStatus = "in_stock" | "missing";

export type ProductDTO = {
  id: number;
  name: string;
  category: string;
  barcode: string | null;
  photoUri: string | null;
  purchaseCount: number;
  status: ProductStatus;
  alertThreshold: string | null;
  inventoryQuantity: string;
  inventoryStatus: InventoryStatus;
  consumptionCount: number;
  lastConsumedAt: string | null;
  archived: boolean;
  occasional: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NewProductInput = {
  name: string;
  category: string;
  barcode?: string | null;
  photoUri?: string | null;
  alertThreshold?: string | null;
  occasional?: boolean;
};

export type ShoppingListDTO = {
  id: number;
  name: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ShoppingListItemDTO = {
  id: number;
  shoppingListId: number;
  productId: number;
  productName: string;
  category: string;
  productStatus: ProductStatus;
  quantity: string;
  checked: boolean;
};

export type PurchaseHistoryDTO = {
  id: number;
  productId: number;
  productName: string;
  category: string;
  quantity: string;
  purchasedAt: string;
  sourceListId: number | null;
  sourceListName: string | null;
};
