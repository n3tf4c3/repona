import Link from "next/link";
import { ShoppingBasket, ArrowRight } from "lucide-react";

export default function HomePage() {
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
      <div className="flex flex-col items-center gap-3">
        <Link
          href="/login"
          className="flex items-center gap-2 rounded-xl bg-ink px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Entrar
          <ArrowRight size={16} strokeWidth={2.4} />
        </Link>
        <Link href="/cadastro" className="text-sm font-semibold text-ink-soft hover:text-ink">
          Criar conta
        </Link>
      </div>
    </main>
  );
}
