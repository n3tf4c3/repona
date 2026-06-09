import type { PurchaseHistoryDTO, ShoppingTotalEstimate } from "@repona/core";
import { estimateShoppingTotal } from "@repona/core";
import { corDaCategoria } from "@/lib/categorias";

// Porte de apps/mobile/src/purchaseHistoryPresentation.ts (sem ícones do Expo;
// usa cor da categoria como marcador).

export type HistoricoLinha = { name: string; quantity: string };

export type HistoricoItem = {
  id: string;
  title: string;
  dateLabel: string;
  countLabel: string;
  cores: string[];
  more: string | null;
  // Itens comprados (nome + quantidade) e o total estimado pelo último preço
  // conhecido de cada produto. total é null quando não há mapa de preços.
  lines: HistoricoLinha[];
  total: ShoppingTotalEstimate | null;
};

export type HistoricoGrupo = {
  title: string;
  items: HistoricoItem[];
};

const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const shortMonths = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const longMonths = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type Compra = {
  key: string;
  purchasedAt: string;
  sourceListName: string | null;
  records: PurchaseHistoryDTO[];
};

export function agruparHistorico(
  records: PurchaseHistoryDTO[],
  precoPorProduto?: Map<number, number>
): HistoricoGrupo[] {
  const compras = records.reduce<Compra[]>((items, record) => {
    // Agrupa pela verdade compartilhada (nome da lista), não pelo sourceListId —
    // o id é local e vem nulo nas compras sincronizadas. (auditoria 2026-06-09 #5)
    const key = `${record.purchasedAt}-${record.sourceListName ?? "manual"}`;
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

  return compras.reduce<HistoricoGrupo[]>((groups, compra) => {
    const title = tituloDoGrupo(compra.purchasedAt);
    const item = compraParaItem(compra, precoPorProduto);
    const existing = groups.find((group) => group.title === title);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.push({ title, items: [item] });
    }
    return groups;
  }, []);
}

function compraParaItem(compra: Compra, precoPorProduto?: Map<number, number>): HistoricoItem {
  const count = compra.records.length;
  const label = count === 1 ? "item" : "itens";
  const lines = compra.records.map((r) => ({ name: r.productName, quantity: r.quantity }));
  const total = precoPorProduto
    ? estimateShoppingTotal(
        compra.records.map((r) => ({
          priceCents: precoPorProduto.get(r.productId) ?? null,
          quantity: r.quantity,
        }))
      )
    : null;
  return {
    id: compra.key,
    title: compra.sourceListName ?? "Compra finalizada",
    dateLabel: formatarData(compra.purchasedAt),
    countLabel: `${count} ${label}`,
    cores: compra.records.slice(0, 3).map((r) => corDaCategoria(r.category)),
    more: count > 3 ? `+${count - 3}` : null,
    lines,
    total,
  };
}

// O rótulo do dia usa o fuso LOCAL de propósito (é o que o usuário espera ver);
// o dedupe do sync usa UTC para ser estável entre dispositivos. Objetivos
// diferentes, não uma inconsistência. (auditoria 2026-06-09 #8)
function tituloDoGrupo(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Histórico";
  const today = new Date();
  if (mesmoDia(date, today)) return "Hoje";
  const month = longMonths[date.getMonth()];
  return date.getFullYear() === today.getFullYear() ? month : `${month} ${date.getFullYear()}`;
}

function formatarData(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data salva";
  return `${weekdays[date.getDay()]}, ${date.getDate()} ${shortMonths[date.getMonth()]}`;
}

function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}
