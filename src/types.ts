import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

export type TabKey = 'home' | 'list' | 'products' | 'history' | 'future';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type Product = {
  id?: number;
  name: string;
  category?: string;
  barcode?: string | null;
  photoUri?: string | null;
  meta: string;
  icon: IconName;
  background: string;
  tint: string;
};

export type NewProductInput = {
  name: string;
  category: string;
  barcode?: string | null;
  photoUri?: string | null;
};

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
