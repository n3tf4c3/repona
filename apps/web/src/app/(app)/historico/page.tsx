import { Receipt, ShoppingBag } from "lucide-react";
import { requireCasa } from "@/server/auth/session";
import { listarHistorico } from "@/server/modules/historico";
import { agruparHistorico } from "@/lib/historico";

export default async function HistoricoPage() {
  const { casaId: id } = await requireCasa();
  const registros = await listarHistorico(id);
  const grupos = agruparHistorico(registros);

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
          {grupo.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-card border border-line bg-surface p-4 shadow-sm"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary-strong">
                <ShoppingBag size={20} strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{item.title}</p>
                <p className="text-xs text-ink-faint">
                  {item.dateLabel} · {item.countLabel}
                </p>
              </div>
              <div className="flex items-center">
                {item.cores.map((cor, i) => (
                  <span
                    key={i}
                    className="inline-block h-7 w-7 rounded-full border-2 border-surface"
                    style={{ backgroundColor: cor, marginLeft: i === 0 ? 0 : -10 }}
                  />
                ))}
                {item.more && <span className="ml-1 text-xs font-bold text-ink-faint">{item.more}</span>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
