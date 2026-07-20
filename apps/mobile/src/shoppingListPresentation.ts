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

export function shoppingListRecordToItem(record: ShoppingListItemRecord): ShoppingItem {
  return {
    id: record.id,
    productId: record.productId,
    category: record.category,
    categoryColor: categoryColors[record.category] ?? colors.primary,
    name: record.productName,
    meta: `${record.category} · ${record.quantity}`,
    quantity: record.quantity,
    checked: record.checked,
    missing: record.productStatus === 'missing',
  };
}
