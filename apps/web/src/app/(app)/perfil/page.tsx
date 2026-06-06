import { getAuthSession } from "@/server/auth/session";

const recursos = [
  { title: "Scanner de código", description: "Aponte a câmera e adicione produtos pelo código de barras." },
  { title: "Cadastro por foto", description: "Tire uma foto do produto e complete o cadastro em menos passos." },
  { title: "Estoque doméstico", description: "Saiba o que tem em casa, o que está acabando e o que precisa repor." },
  { title: "Compartilhamento familiar", description: "Toda a família na mesma lista, atualizada em tempo real." },
  { title: "Sugestões inteligentes", description: "Recompras previstas a partir dos hábitos de consumo." },
  { title: "Ciclo de vida do item", description: "Planejado, comprado, consumido e em falta em um único fluxo." },
];

export default async function PerfilPage() {
  const session = await getAuthSession();
  const nome = session?.user?.name ?? "Você";
  const email = session?.user?.email ?? "";
  const inicial = (nome || email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-[#8E9180]">No horizonte</p>
        <h1 className="text-2xl font-black tracking-tight">Casa Repona</h1>
      </div>

      {/* Conta */}
      <div className="flex items-center gap-4 rounded-2xl border border-[#E7E5D9] bg-white p-5 shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#E2F0E5] text-xl font-black text-[#236B43]">
          {inicial}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-black">{nome}</p>
          {email && <p className="truncate text-sm text-[#8E9180]">{email}</p>}
        </div>
      </div>

      {/* Hero */}
      <div className="rounded-2xl border border-[#E7E5D9] bg-[#F0F7F0] p-5">
        <p className="text-lg font-black text-[#236B43]">Feito para famílias brasileiras</p>
        <p className="mt-1 text-sm text-[#5C604F]">
          A lista de compras e o estoque da casa em um só lugar — com sugestões a partir dos seus
          hábitos de consumo.
        </p>
      </div>

      {/* Roadmap */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-[#5C604F]">Feito para crescer</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {recursos.map((recurso) => (
            <div key={recurso.title} className="rounded-2xl border border-[#E7E5D9] bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold">{recurso.title}</p>
                <span className="shrink-0 rounded-full bg-[#FBEAD4] px-2 py-0.5 text-xs font-bold text-[#9A6314]">
                  Em breve
                </span>
              </div>
              <p className="mt-1 text-sm text-[#8E9180]">{recurso.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
