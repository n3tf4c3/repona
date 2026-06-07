import type { PurchaseHistoryRecord } from './storage/purchaseHistory';
import { colors } from './theme';
import type { IconName } from './types';

export type PurchaseHistoryThumb = {
  icon: IconName;
  background: string;
  tint: string;
};

export type PurchaseHistoryLine = {
  productId: number;
  name: string;
  quantity: string;
};

export type PurchaseHistoryItem = {
  id: string;
  title: string;
  total: string;
  date: string;
  count: string;
  thumbs: PurchaseHistoryThumb[];
  more: string | null;
  lines: PurchaseHistoryLine[];
};

export type PurchaseHistoryGroup = {
  title: string;
  items: PurchaseHistoryItem[];
};

type Purchase = {
  key: string;
  purchasedAt: string;
  sourceListName: string | null;
  records: PurchaseHistoryRecord[];
};

const categoryVisuals: Record<string, PurchaseHistoryThumb> = {
  'Laticínios': thumb('bottle-tonic-outline', colors.amberSoft, colors.amber),
  'Hortifrúti': thumb('food-apple-outline', colors.primarySoft, colors.primaryStrong),
  'Bebidas': thumb('coffee-outline', colors.coralSoft, colors.coral),
  'Limpeza': thumb('spray-bottle', colors.indigoSoft, colors.indigo),
  'Mercearia': thumb('basket-outline', colors.amberSoft, colors.amber),
};

const fallbackThumb = thumb('package-variant-closed', colors.primarySoft, colors.primaryStrong);

const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const shortMonths = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const longMonths = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function purchaseHistoryRecordsToGroups(records: PurchaseHistoryRecord[]): PurchaseHistoryGroup[] {
  const purchases = records.reduce<Purchase[]>((items, record) => {
    const key = `${record.purchasedAt}-${record.sourceListId ?? 'manual'}`;
    const existing = items.find((item) => item.key === key);

    if (existing) {
      existing.records.push(record);
    } else {
      items.push({
        key,
        purchasedAt: record.purchasedAt,
        sourceListName: record.sourceListName,
        records: [record],
      });
    }

    return items;
  }, []);

  return purchases.reduce<PurchaseHistoryGroup[]>((groups, purchase) => {
    const title = getGroupTitle(purchase.purchasedAt);
    const existing = groups.find((group) => group.title === title);
    const item = purchaseToHistoryItem(purchase);

    if (existing) {
      existing.items.push(item);
    } else {
      groups.push({ title, items: [item] });
    }

    return groups;
  }, []);
}

function purchaseToHistoryItem(purchase: Purchase): PurchaseHistoryItem {
  const count = purchase.records.length;
  const itemLabel = count === 1 ? 'item' : 'itens';

  return {
    id: purchase.key,
    title: purchase.sourceListName ?? 'Compra finalizada',
    total: `${count} ${itemLabel}`,
    date: formatDate(purchase.purchasedAt),
    count: `${count} ${itemLabel}`,
    thumbs: purchase.records.slice(0, 3).map((record) => categoryVisuals[record.category] ?? fallbackThumb),
    more: count > 3 ? `+${count - 3}` : null,
    lines: purchase.records.map((record) => ({ productId: record.productId, name: record.productName, quantity: record.quantity })),
  };
}

function getGroupTitle(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Histórico';
  }

  const today = new Date();

  if (isSameDay(date, today)) {
    return 'Hoje';
  }

  const month = longMonths[date.getMonth()];

  if (date.getFullYear() === today.getFullYear()) {
    return month;
  }

  return `${month} ${date.getFullYear()}`;
}

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Data salva';
  }

  return `${weekdays[date.getDay()]}, ${date.getDate()} ${shortMonths[date.getMonth()]}`;
}

function isSameDay(date: Date, otherDate: Date) {
  return date.getDate() === otherDate.getDate()
    && date.getMonth() === otherDate.getMonth()
    && date.getFullYear() === otherDate.getFullYear();
}

function thumb(icon: IconName, background: string, tint: string): PurchaseHistoryThumb {
  return { icon, background, tint };
}
