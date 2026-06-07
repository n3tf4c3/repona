"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ShoppingBasket, AlertCircle } from "lucide-react";
import { cadastrarAction } from "./actions";

const inputClass =
  "w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink outline-none transition placeholder:text-ink-faint focus:border-primary";

export default function CadastroPage() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
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
    const result = await cadastrarAction({ nome, email, senha });
    if (!result.ok) {
      setLoading(false);
      setError(result.error);
      return;
    }

    const signInResult = await signIn("credentials", { email, password: senha, redirect: false });
    setLoading(false);
    if (signInResult?.ok) {
      router.push("/inicio");
      router.refresh();
      return;
    }
    // Conta criada, mas o login automático falhou: manda para o login manual.
    router.push("/login");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-strong">
          <ShoppingBasket size={28} strokeWidth={2.2} />
        </span>
        <div>
          <h1 className="text-2xl font-black tracking-tight">Criar conta no Repona</h1>
          <p className="mt-1 text-sm text-ink-faint">Comece a organizar a lista e o estoque da sua casa.</p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <label htmlFor="nome" className="text-sm font-semibold text-ink-soft">
            Nome <span className="font-normal text-ink-faint">(opcional)</span>
          </label>
          <input
            id="nome"
            type="text"
            autoComplete="name"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className={inputClass}
          />
        </div>
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
          <label htmlFor="senha" className="text-sm font-semibold text-ink-soft">
            Senha
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
            Confirmar senha
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
          {loading ? "Criando conta..." : "Criar conta"}
        </button>
      </form>
      <p className="text-center text-sm text-ink-faint">
        Já tem conta?{" "}
        <Link href="/login" className="font-semibold text-ink-soft hover:text-ink">
          Entrar
        </Link>
      </p>
    </main>
  );
}
