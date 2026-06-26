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
  // Marca do produto (digitada ou vinda do Open Food Facts via scanner).
  brand: string | null;
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
  brand?: string | null;
  barcode?: string | null;
  photoUri?: string | null;
  alertThreshold?: string | null;
  occasional?: boolean;
};

// Categorias de produto — fonte única para os chips do mobile e o enum de
// validação do web, que antes mantinham cópias separadas da mesma lista.
// (auditoria 2026-06-09 #5)
export const CATEGORIAS = ["Hortifrúti", "Laticínios", "Mercearia", "Bebidas", "Limpeza"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

// Limites de tamanho dos campos que viajam no sync. São o teto vinculante: um
// valor acima disso faz a validação do snapshot rejeitar o sync INTEIRO da casa.
// Fonte única usada na criação (web/mobile) e no schema do endpoint de sync, para
// não divergirem. (auditoria 2026-06-09 #3)
export const FIELD_LIMITS = {
  name: 160,
  category: 80,
  brand: 80,
  barcode: 120,
  quantity: 40,
  alertThreshold: 40,
} as const;

// Teto de preço (em centavos) aceito no sync — o mesmo validado no endpoint e na
// gravação local do mobile, para um preço fora do limite não travar o snapshot
// inteiro da casa. (auditoria #29)
export const MAX_PRICE_CENTS = 100_000_000;

// Valida os tamanhos antes de gravar, evitando criar um produto que depois
// trava o sync. Lança "PRODUCT_FIELD_TOO_LONG" — um código só, mapeado para uma
// mensagem amigável nas duas UIs.
export function validateProductFields(input: NewProductInput): void {
  if (
    input.name.trim().length > FIELD_LIMITS.name ||
    (input.category ?? "").length > FIELD_LIMITS.category ||
    (input.brand ?? "").length > FIELD_LIMITS.brand ||
    (input.barcode ?? "").length > FIELD_LIMITS.barcode ||
    (input.alertThreshold ?? "").length > FIELD_LIMITS.alertThreshold
  ) {
    throw new Error("PRODUCT_FIELD_TOO_LONG");
  }
}

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
