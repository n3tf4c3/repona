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
  const isMissing = record.status === 'missing' || record.inventoryStatus === 'missing';
  const visual = isMissing
    ? { icon: 'coffee-outline' as IconName, background: colors.coralSoft, tint: colors.coral }
    : categoryVisuals[record.category] ?? fallbackVisual;

  return {
    id: record.id,
    name: record.name,
    category: record.category,
    brand: record.brand,
    barcode: record.barcode,
    photoUri: record.photoUri,
    purchaseCount: record.purchaseCount,
    alertThreshold: record.alertThreshold,
    inventoryQuantity: record.inventoryQuantity,
    inventoryStatus: record.inventoryStatus,
    consumptionCount: record.consumptionCount,
    lastConsumedAt: record.lastConsumedAt,
    archived: record.archived,
    occasional: record.occasional,
    meta: buildProductMeta(record),
    ...visual,
  };
}

function buildProductMeta(record: ProductRecord): string {
  // Marca na frente, quando existe: "Urbano · Mercearia · 1 kg em casa".
  const prefixo = record.brand ? `${record.brand} · ` : '';

  if (record.status === 'missing' || record.inventoryStatus === 'missing') {
    return `${prefixo}${record.category} · em falta`;
  }

  if (record.inventoryQuantity && record.inventoryQuantity !== '0 un') {
    return `${prefixo}${record.category} · ${record.inventoryQuantity} em casa`;
  }

  if (record.purchaseCount > 0) {
    return `${prefixo}${record.category} · ${record.purchaseCount} compras`;
  }

  return `${prefixo}${record.category} · novo`;
}
