import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { NewProductInput as CoreNewProductInput } from '@repona/core';

export type TabKey = 'home' | 'list' | 'products' | 'history' | 'future';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type Product = {
  id?: number;
  name: string;
  category?: string;
  barcode?: string | null;
  photoUri?: string | null;
  purchaseCount?: number;
  alertThreshold?: string | null;
  inventoryQuantity?: string;
  inventoryStatus?: 'in_stock' | 'missing';
  consumptionCount?: number;
  lastConsumedAt?: string | null;
  meta: string;
  icon: IconName;
  background: string;
  tint: string;
};

export type NewProductInput = CoreNewProductInput;

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
