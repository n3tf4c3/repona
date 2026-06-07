"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { redefinirSenhaAction } from "./actions";

const inputClass =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink outline-none transition placeholder:text-ink-faint focus:border-primary";

export function RedefinirForm({ token }: { token: string }) {
  const router = useRouter();
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (senha.length < 8) {
      setError("A senha precisa ter ao menos 8 caracteres.");
      return;
    }
    if (senha !== confirmar) {
      setError("As senhas não coincidem.");
      return;
    }

    setLoading(true);
    const result = await redefinirSenhaAction({ token, senha });
    setLoading(false);
    if (result.ok) {
      router.push("/login");
      return;
    }
    setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-sm">
      <div className="flex flex-col gap-2">
        <label htmlFor="senha" className="text-sm font-semibold text-ink-soft">
          Nova senha
        </label>
        <input
          id="senha"
          type="password"
          autoComplete="new-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="confirmar" className="text-sm font-semibold text-ink-soft">
          Confirmar nova senha
        </label>
        <input
          id="confirmar"
          type="password"
          autoComplete="new-password"
          required
          value={confirmar}
          onChange={(e) => setConfirmar(e.target.value)}
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
        {loading ? "Salvando..." : "Salvar nova senha"}
      </button>
    </form>
  );
}
