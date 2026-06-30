import { revalidatePath } from "next/cache";
import { excluirCasa } from "@/server/modules/casa";
import { listarCasas } from "@/server/modules/admin";
import { DeleteCasaButton } from "./delete-button.client";

// Acesso protegido pelo middleware (Basic Auth via ADMIN_SECRET). Não usa a
// sessão de casa do (app); fica fora daquele grupo de rotas de propósito.
export const dynamic = "force-dynamic";

async function excluirCasaAction(formData: FormData) {
  "use server";
  const id = Number(formData.get("id"));
  if (Number.isInteger(id) && id > 0) {
    await excluirCasa(id);
    revalidatePath("/admin");
  }
}

function formatarData(d: Date): string {
  return new Date(d).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminPage() {
  const casas = await listarCasas();
  const vazias = casas.filter((c) => c.produtos === 0 && c.compras === 0).length;

  return (
    <main className="mx-auto max-w-4xl p-6 sm:p-8">
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-wider text-ink-faint">Painel</p>
        <h1 className="text-2xl font-black tracking-tight">Casas</h1>
        <p className="mt-1 text-sm text-ink-faint">
          {casas.length} {casas.length === 1 ? "casa" : "casas"} · {vazias}{" "}
          {vazias === 1 ? "vazia" : "vazias"} (sem produtos nem compras)
        </p>
      </div>

      {casas.length === 0 ? (
        <p className="rounded-card border border-line bg-surface p-6 text-sm text-ink-faint">
          Nenhuma casa criada ainda.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wider text-ink-faint">
              <tr>
                <th className="px-4 py-3 font-bold">#</th>
                <th className="px-4 py-3 font-bold">Nome</th>
                <th className="px-4 py-3 font-bold">Criada</th>
                <th className="px-4 py-3 text-right font-bold">Produtos</th>
                <th className="px-4 py-3 text-right font-bold">Compras</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {casas.map((c) => {
                const vazia = c.produtos === 0 && c.compras === 0;
                return (
                  <tr key={c.id} className="border-b border-line2 last:border-0">
                    <td className="px-4 py-3 font-mono text-ink-faint">{c.id}</td>
                    <td className="px-4 py-3 font-bold">
                      {c.name}
                      {vazia && (
                        <span className="ml-2 rounded-full bg-amber-soft px-2 py-0.5 text-xs font-bold text-amber-ink">
                          vazia
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{formatarData(c.createdAt)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.produtos}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.compras}</td>
                    <td className="px-4 py-3 text-right">
                      <DeleteCasaButton id={c.id} name={c.name} action={excluirCasaAction} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
