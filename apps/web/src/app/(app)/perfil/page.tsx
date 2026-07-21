import { ScanLine, Camera, Home, Users, Brain, RefreshCw, type LucideIcon } from "lucide-react";
import { getAuthSession, requireCasa } from "@/server/auth/session";
import { obterCasaPorId } from "@/server/modules/casa";
import { CasaClient } from "./casa-client";

// "app": já disponível no aplicativo. "breve": ainda no roadmap.
const recursos: { title: string; description: string; Icon: LucideIcon; status: "app" | "breve" }[] = [
  { title: "Scanner de código", description: "Aponte a câmera e adicione produtos pelo código de barras.", Icon: ScanLine, status: "app" },
  { title: "Cadastro por foto", description: "Tire uma foto do produto e complete o cadastro em menos passos.", Icon: Camera, status: "breve" },
  { title: "Estoque doméstico", description: "Saiba o que tem em casa, o que está acabando e o que precisa repor.", Icon: Home, status: "app" },
  { title: "Compartilhamento familiar", description: "Catálogo, estoque e histórico da casa compartilhados entre os aparelhos.", Icon: Users, status: "app" },
  { title: "Sugestões inteligentes", description: "Recompras previstas a partir dos hábitos de consumo.", Icon: Brain, status: "app" },
  { title: "Ciclo de vida do item", description: "Planejado, comprado, consumido e em falta em um único fluxo.", Icon: RefreshCw, status: "app" },
];

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: Promise<{ tokenAtualizado?: string }>;
}) {
  const { casaId } = await requireCasa();
  const session = await getAuthSession();
  const casa = await obterCasaPorId(casaId);
  // Nome vem do banco (reflete renomeação imediata); o JWT é fallback.
  const nome = casa?.name ?? session?.user?.name ?? "Sua conta";
  const inicial = (nome || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-ink-faint">Sua conta</p>
        <h1 className="text-2xl font-black tracking-tight">Casa Repona</h1>
      </div>

      {/* Conta */}
      <div className="flex items-center gap-4 rounded-card border border-line bg-surface p-5 shadow-sm">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xl font-black text-primary-strong">
          {inicial}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-black">{nome}</p>
          <p className="truncate text-sm text-ink-faint">Conta criada no app · acesso por token</p>
        </div>
      </div>

      {/* Casa (token de acesso) */}
      <CasaClient
        casa={casa}
        tokenAtualizado={(await searchParams).tokenAtualizado === "1"}
      />

      {/* Hero */}
      <div className="rounded-card border border-line bg-primary-tint p-5">
        <p className="text-lg font-black text-primary-strong">Feito para famílias brasileiras</p>
        <p className="mt-1 text-sm text-ink-soft">
          A lista de compras e o estoque da casa em um só lugar — com sugestões a partir dos seus
          hábitos de consumo.
        </p>
      </div>

      {/* Roadmap */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-ink-soft">Recursos</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {recursos.map(({ title, description, Icon, status }) => (
            <div key={title} className="rounded-card border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-bold">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary-strong">
                    <Icon size={16} strokeWidth={2.2} />
                  </span>
                  {title}
                </span>
                {status === "app" ? (
                  <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary-strong">
                    No app
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-amber-soft px-2 py-0.5 text-xs font-bold text-amber-ink">
                    Em breve
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-ink-faint">{description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
