"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ShoppingBasket, AlertCircle, MailCheck } from "lucide-react";
import { solicitarResetAction } from "./actions";

const inputClass =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink outline-none transition placeholder:text-ink-faint focus:border-primary";

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const result = await solicitarResetAction(email);
    setLoading(false);
    if (result.ok) {
      setEnviado(true);
      return;
    }
    setError(result.error);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-strong">
          <ShoppingBasket size={28} strokeWidth={2.2} />
        </span>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Recuperar senha</h1>
          <p className="mt-1 text-sm text-ink-faint">Enviaremos um link para redefinir sua senha.</p>
        </div>
      </div>

      {enviado ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-6 text-center shadow-sm">
          <MailCheck size={28} className="text-primary-strong" />
          <p className="text-sm text-ink-soft">
            Se houver uma conta com esse e-mail, enviamos um link para redefinir a senha. O link vale por 1 hora.
          </p>
        </div>
      ) : (
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
            {loading ? "Enviando..." : "Enviar link"}
          </button>
        </form>
      )}

      <Link href="/login" className="text-center text-sm text-ink-faint hover:text-ink-soft">
        Voltar para entrar
      </Link>
    </main>
  );
}
