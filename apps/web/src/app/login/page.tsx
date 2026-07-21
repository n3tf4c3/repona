"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ShoppingBasket, AlertCircle } from "lucide-react";
import { CASA_CODE_LENGTH } from "@repona/core";
import { transportErrorMessage, withClientTimeout } from "@/lib/clientAsync";

const inputClass =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 text-center text-lg font-black uppercase tracking-[0.3em] text-ink outline-none transition placeholder:text-ink-faint placeholder:tracking-normal placeholder:font-normal placeholder:text-base focus:border-primary";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await withClientTimeout(
        signIn("credentials", { token: token.trim().toUpperCase(), redirect: false })
      );
      if (result?.ok) {
        router.push("/inicio");
        router.refresh();
        return;
      }
      setError("Token inválido. Confira o código gerado no app.");
    } catch (cause) {
      setError(transportErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-strong">
          <ShoppingBasket size={28} strokeWidth={2.2} />
        </span>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Entrar no Repona</h1>
          <p className="mt-1 text-sm text-ink-faint">Use o token de acesso gerado no app do celular.</p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <label htmlFor="token" className="text-sm font-semibold text-ink-soft">
            Token de acesso
          </label>
          <input
            id="token"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={CASA_CODE_LENGTH}
            required
            value={token}
            onChange={(e) => setToken(e.target.value.toUpperCase())}
            placeholder={`${CASA_CODE_LENGTH} caracteres`}
            className={inputClass}
          />
        </div>
        {error && (
          <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-danger">
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
      <p className="text-center text-sm text-ink-faint">
        Ainda não tem token? Crie sua conta no app do celular.
      </p>
      <Link href="/" className="text-center text-sm text-ink-faint hover:text-ink-soft">
        Voltar
      </Link>
    </main>
  );
}
