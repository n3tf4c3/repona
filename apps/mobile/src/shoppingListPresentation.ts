import { colors } from './theme';
import { ShoppingItem } from './types';
import { ShoppingListItemRecord } from './storage/shoppingLists';

const categoryColors: Record<string, string> = {
  'Hortifrúti': colors.primary,
  'Laticínios': colors.amber,
  'Bebidas': colors.amber,
  'Mercearia': colors.indigo,
  'Limpeza': colors.indigo,
};

const productMeta: Record<string, string> = {
  'Maçã Fuji': 'R$ 8,90 / kg',
  'Cenoura': 'R$ 4,50 / kg',
  'Banana prata': 'R$ 5,20 / kg',
  'Leite integral': 'R$ 5,49 · 2 un',
  'Suco de laranja': 'R$ 7,90 · 1 un',
};

export function shoppingListRecordToItem(record: ShoppingListItemRecord): ShoppingItem {
  return {
    id: record.id,
    productId: record.productId,
    category: record.category,
    categoryColor: categoryColors[record.category] ?? colors.primary,
    name: record.productName,
    meta: productMeta[record.productName] ?? `${record.category} · ${record.quantity}`,
    quantity: record.quantity,
    checked: record.checked,
    missing: record.productStatus === 'missing',
  };
}
