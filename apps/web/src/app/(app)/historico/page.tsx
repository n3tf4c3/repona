import { ChevronDown, Receipt, ShoppingBag } from "lucide-react";
import { requireCasa } from "@/server/auth/session";
import { listarHistorico, ultimoPrecoPorProduto } from "@/server/modules/historico";
import { agruparHistorico } from "@/lib/historico";
import { decodeHistoricoCursor, encodeHistoricoCursor } from "@/lib/historicoCursor";
import { formatCentsBRL } from "@/lib/preco";

const TAMANHO_PAGINA = 50;

export default async function HistoricoPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { casaId: id } = await requireCasa();
  const cursor = decodeHistoricoCursor((await searchParams).cursor);

  const pagina = await listarHistorico(id, { limit: TAMANHO_PAGINA, cursor });
  const precoPorProduto = await ultimoPrecoPorProduto(
    id,
    pagina.items.map((item) => item.productId)
  );
  const grupos = agruparHistorico(pagina.items, precoPorProduto);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-ink-faint">Suas compras anteriores</p>
        <h1 className="text-2xl font-black tracking-tight">Histórico</h1>
      </div>

      {grupos.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line py-12 text-center text-ink-faint">
          <Receipt size={32} strokeWidth={1.6} />
          <p className="text-sm">
            Nenhuma compra registrada. Finalize itens na{" "}
            <span className="font-semibold">Lista</span> para criar o histórico.
          </p>
        </div>
      )}

      {grupos.map((grupo) => (
        <div key={grupo.title} className="space-y-2">
          <h2 className="pt-2 text-sm font-bold text-ink-soft">{grupo.title}</h2>
          {grupo.items.map((item) => {
            const temPreco = item.total !== null && item.total.pricedCount > 0;
            return (
              <details
                key={item.id}
                className="group rounded-card border border-line bg-surface shadow-sm"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary-strong">
                    <ShoppingBag size={20} strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{item.title}</p>
                    <p className="text-xs text-ink-faint">
                      {item.dateLabel} · {item.countLabel}
                    </p>
                  </div>
                  {temPreco && (
                    <div className="text-right">
                      <p className="font-bold tabular-nums">{formatCentsBRL(item.total!.totalCents)}</p>
                      <p className="text-[10px] text-ink-faint">
                        {item.total!.missingCount > 0 ? "estimado · parcial" : "estimado"}
                      </p>
                    </div>
                  )}
                  <ChevronDown
                    size={18}
                    className="shrink-0 text-ink-faint transition-transform group-open:rotate-180"
                  />
                </summary>

                <div className="space-y-1.5 border-t border-line px-4 pb-4 pt-3">
                  {item.lines.map((line, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink-soft">{line.name}</span>
                      <span className="shrink-0 text-ink-faint tabular-nums">{line.quantity}</span>
                    </div>
                  ))}

                  {temPreco && (
                    <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                      <span className="text-xs font-semibold text-ink-soft">
                        Total estimado
                        {item.total!.missingCount > 0 ? ` · ${item.total!.missingCount} sem preço` : ""}
                      </span>
                      <span className="font-bold tabular-nums">{formatCentsBRL(item.total!.totalCents)}</span>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      ))}

      <div className="flex gap-2">
        {cursor && (
          <a
            href="/historico"
            className="mt-2 flex flex-1 items-center justify-center rounded-card border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink-soft shadow-sm transition hover:bg-bg"
          >
            Mais recentes
          </a>
        )}
        {pagina.nextCursor && (
          <a
            href={`/historico?cursor=${encodeURIComponent(encodeHistoricoCursor(pagina.nextCursor))}`}
            className="mt-2 flex flex-1 items-center justify-center rounded-card border border-line bg-surface px-4 py-3 text-sm font-semibold text-ink-soft shadow-sm transition hover:bg-bg"
          >
            Mais antigos
          </a>
        )}
      </div>
    </div>
  );
}
