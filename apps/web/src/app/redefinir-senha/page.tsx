import Link from "next/link";
import { ShoppingBasket } from "lucide-react";
import { RedefinirForm } from "./redefinir-form";

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-strong">
          <ShoppingBasket size={28} strokeWidth={2.2} />
        </span>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Definir nova senha</h1>
          <p className="mt-1 text-sm text-ink-faint">Escolha uma senha de ao menos 8 caracteres.</p>
        </div>
      </div>

      {token ? (
        <RedefinirForm token={token} />
      ) : (
        <div className="rounded-card border border-line bg-surface p-6 text-center text-sm text-ink-soft shadow-sm">
          Link inválido. Solicite a redefinição novamente.
        </div>
      )}

      <Link href="/login" className="text-center text-sm text-ink-faint hover:text-ink-soft">
        Voltar para entrar
      </Link>
    </main>
  );
}
