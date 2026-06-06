"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ShoppingBasket, AlertCircle } from "lucide-react";

const inputClass =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink outline-none transition placeholder:text-ink-faint focus:border-primary";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const result = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (result?.ok) {
      router.push("/inicio");
      router.refresh();
      return;
    }
    setError("E-mail ou senha inválidos.");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-strong">
          <ShoppingBasket size={28} strokeWidth={2.2} />
        </span>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Entrar no Repona</h1>
          <p className="mt-1 text-sm text-ink-faint">Acesse a lista e o estoque da sua casa.</p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-sm font-semibold text-ink-soft">
            E-mail
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="text-sm font-semibold text-ink-soft">
            Senha
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        {error && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
            <AlertCircle size={15} />
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
      <Link href="/" className="text-center text-sm text-ink-faint hover:text-ink-soft">
        Voltar
      </Link>
    </main>
  );
}
