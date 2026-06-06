import { colors } from './theme';
import { IconName, Product } from './types';
import { ProductRecord } from './storage/products';

type ProductVisual = {
  icon: IconName;
  background: string;
  tint: string;
};

const categoryVisuals: Record<string, ProductVisual> = {
  'Laticínios': {
    icon: 'bottle-tonic-outline',
    background: colors.amberSoft,
    tint: colors.amber,
  },
  'Hortifrúti': {
    icon: 'food-apple-outline',
    background: colors.primarySoft,
    tint: colors.primaryStrong,
  },
  'Bebidas': {
    icon: 'coffee-outline',
    background: colors.coralSoft,
    tint: colors.coral,
  },
  'Limpeza': {
    icon: 'spray-bottle',
    background: colors.indigoSoft,
    tint: colors.indigo,
  },
  'Mercearia': {
    icon: 'basket-outline',
    background: colors.amberSoft,
    tint: colors.amber,
  },
};

const fallbackVisual: ProductVisual = {
  icon: 'package-variant-closed',
  background: colors.primarySoft,
  tint: colors.primaryStrong,
};

export function productRecordToProduct(record: ProductRecord): Product {
  const visual = record.status === 'missing'
    ? { icon: 'coffee-outline' as IconName, background: colors.coralSoft, tint: colors.coral }
    : categoryVisuals[record.category] ?? fallbackVisual;

  return {
    id: record.id,
    name: record.name,
    category: record.category,
    barcode: record.barcode,
    photoUri: record.photoUri,
    meta: buildProductMeta(record),
    ...visual,
  };
}

function buildProductMeta(record: ProductRecord): string {
  if (record.status === 'missing') {
    return `${record.category} · em falta`;
  }

  if (record.purchaseCount > 0) {
    return `${record.category} · ${record.purchaseCount} compras`;
  }

  return `${record.category} · novo`;
}
