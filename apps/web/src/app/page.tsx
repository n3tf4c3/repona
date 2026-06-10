import Link from "next/link";
import { redirect } from "next/navigation";
import { ShoppingBasket, ArrowRight } from "lucide-react";
import { getAuthSession } from "@/server/auth/session";

export default async function HomePage() {
  // Quem já tem sessão (cookie de 30 dias) vai direto pro app, sem ver o
  // "Entrar com token". Se a sessão estiver inválida, o layout do (app)
  // devolve pro /login.
  const session = await getAuthSession();
  if (session?.user?.id) redirect("/inicio");
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-primary-soft text-primary-strong">
        <ShoppingBasket size={32} strokeWidth={2.2} />
      </span>
      <div>
        <h1 className="text-4xl font-black tracking-tight">Repona</h1>
        <p className="mt-2 text-base text-ink-soft">
          Lista de compras e controle de estoque da sua casa — agora na web.
        </p>
      </div>
      <Link
        href="/login"
        className="flex items-center gap-2 rounded-xl bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
      >
        Entrar com token
        <ArrowRight size={16} strokeWidth={2.4} />
      </Link>
    </main>
  );
}
