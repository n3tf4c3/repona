import Link from "next/link";
import type { ProductStatus } from "@repona/core";

// Uso simbólico de um tipo do @repona/core para validar o link do workspace
// (transpilePackages) no esqueleto. Será substituído por dados reais ao portar as telas.
const statusInicial: ProductStatus = "active";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-black tracking-tight">Repona</h1>
      <p className="text-base text-foreground/70">
        Lista de compras e controle de estoque — agora na web.
      </p>
      <p className="text-sm text-foreground/50">Esqueleto inicial (status: {statusInicial}).</p>
      <Link
        href="/login"
        className="rounded-xl bg-foreground px-6 py-3 text-sm font-semibold text-background"
      >
        Entrar
      </Link>
    </main>
  );
}
