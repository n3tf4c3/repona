import { requireUser } from "@/server/auth/session";
import { listarHistorico } from "@/server/modules/historico";
import { agruparHistorico } from "@/lib/historico";

export default async function HistoricoPage() {
  const { id } = await requireUser();
  const registros = await listarHistorico(id);
  const grupos = agruparHistorico(registros);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-[#8E9180]">
          Suas compras anteriores
        </p>
        <h1 className="text-2xl font-black tracking-tight">Histórico</h1>
      </div>

      {grupos.length === 0 && (
        <p className="py-10 text-center text-sm text-[#8E9180]">
          Nenhuma compra registrada. Finalize itens marcados na{" "}
          <span className="font-semibold">Lista</span> para criar o histórico.
        </p>
      )}

      {grupos.map((grupo) => (
        <div key={grupo.title} className="space-y-2">
          <h2 className="pt-2 text-sm font-bold text-[#5C604F]">{grupo.title}</h2>
          {grupo.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-[#E7E5D9] bg-white p-4 shadow-sm"
            >
              <div>
                <p className="font-bold">{item.title}</p>
                <p className="text-xs text-[#8E9180]">
                  {item.dateLabel} · {item.countLabel}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {item.cores.map((cor, i) => (
                  <span
                    key={i}
                    className="inline-block h-7 w-7 rounded-full border-2 border-white"
                    style={{ backgroundColor: cor, marginLeft: i === 0 ? 0 : -10 }}
                  />
                ))}
                {item.more && (
                  <span className="ml-1 text-xs font-bold text-[#8E9180]">{item.more}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
