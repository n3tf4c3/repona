import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type {
  InventoryAlert as CoreInventoryAlert,
  NewProductInput as CoreNewProductInput,
  RebuySuggestion as CoreRebuySuggestion,
} from '@repona/core';

export type TabKey = 'home' | 'list' | 'estoque' | 'products' | 'history' | 'future';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type Product = {
  id?: number;
  name: string;
  category?: string;
  brand?: string | null;
  barcode?: string | null;
  photoUri?: string | null;
  purchaseCount?: number;
  alertThreshold?: string | null;
  inventoryQuantity?: string;
  inventoryStatus?: 'in_stock' | 'missing';
  consumptionCount?: number;
  lastConsumedAt?: string | null;
  archived?: boolean;
  occasional?: boolean;
  meta: string;
  icon: IconName;
  background: string;
  tint: string;
};

export type NewProductInput = CoreNewProductInput;

// Aliases das regras do core especializados no Product enriquecido do mobile
// (ícone/cores), usados pelo App e pela tela Início.
export type InventoryAlert = CoreInventoryAlert<Product>;
export type RebuySuggestion = CoreRebuySuggestion<Product>;

export type ShoppingItem = {
  id: number;
  productId?: number;
  category: string;
  categoryColor: string;
  name: string;
  meta: string;
  quantity: string;
  checked: boolean;
  missing?: boolean;
};
