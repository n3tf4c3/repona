import type { PurchaseHistoryRecord } from './storage/purchaseHistory';
import {
  groupPurchaseHistoryRecords,
  mergeHistoryGroups,
  type GroupedPurchaseHistory,
} from './purchaseHistoryPagination';
import { colors } from './theme';
import type { IconName } from './types';

export type PurchaseHistoryThumb = {
  icon: IconName;
  background: string;
  tint: string;
};

export type PurchaseHistoryLine = {
  id: number;
  productId: number;
  name: string;
  quantity: string;
};

export type PurchaseHistoryItem = {
  id: string;
  title: string;
  date: string;
  count: string;
  thumbs: PurchaseHistoryThumb[];
  more: string | null;
  lines: PurchaseHistoryLine[];
  purchasedAt: string;
  sourceListName: string | null;
};

export type PurchaseHistoryGroup = {
  title: string;
  items: PurchaseHistoryItem[];
};

type Purchase = GroupedPurchaseHistory<PurchaseHistoryRecord>;

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
  // Agrupa pela verdade compartilhada (nome da lista), não pelo source_list_id
  // — o id é local em cada device. O helper usa Map e mantém custo linear. (#87)
  const purchases: Purchase[] = groupPurchaseHistoryRecords(records);

  // Maps preservam a ordem da primeira ocorrência e eliminam o reduce+find
  // quadrático que congelava a tela em históricos grandes. (#87)
  const groups: PurchaseHistoryGroup[] = [];
  const groupByTitle = new Map<string, PurchaseHistoryGroup>();
  for (const purchase of purchases) {
    const title = getGroupTitle(purchase.purchasedAt);
    const existing = groupByTitle.get(title);
    const item = purchaseToHistoryItem(purchase);

    if (existing) {
      existing.items.push(item);
    } else {
      const group = { title, items: [item] };
      groups.push(group);
      groupByTitle.set(title, group);
    }
  }
  return groups;
}

export function mergePurchaseHistoryGroups(
  current: PurchaseHistoryGroup[],
  incoming: PurchaseHistoryGroup[],
): PurchaseHistoryGroup[] {
  return mergeHistoryGroups(current, incoming);
}

function purchaseToHistoryItem(purchase: Purchase): PurchaseHistoryItem {
  const count = purchase.records.length;
  const itemLabel = count === 1 ? 'item' : 'itens';

  return {
    id: purchase.key,
    title: purchase.sourceListName ?? 'Compra finalizada',
    date: formatDate(purchase.purchasedAt),
    count: `${count} ${itemLabel}`,
    thumbs: purchase.records.slice(0, 3).map((record) => categoryVisuals[record.category] ?? fallbackThumb),
    more: count > 3 ? `+${count - 3}` : null,
    lines: purchase.records.map((record) => ({ id: record.id, productId: record.productId, name: record.productName, quantity: record.quantity })),
    purchasedAt: purchase.purchasedAt,
    sourceListName: purchase.sourceListName,
  };
}

// O rótulo do dia ("Hoje", mês) usa o fuso LOCAL do aparelho de propósito: é o
// que faz sentido pro usuário ver. O dedupe do sync, por outro lado, usa UTC
// (segundos de epoch) para ser estável entre dispositivos — são objetivos
// diferentes, não uma inconsistência. (auditoria 2026-06-09 #8)
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
