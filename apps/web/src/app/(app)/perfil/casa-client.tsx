"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, RefreshCw, Pencil, KeyRound, AlertCircle, Trash2 } from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import type { CasaDTO } from "@/server/modules/casa";
import { excluirContaAction, regenerarCodigoAction, renomearCasaAction } from "./actions";

type Resultado = { ok: boolean; error?: string };

export function CasaClient({ casa }: { casa: CasaDTO }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nome, setNome] = useState(casa.name);
  const [codigo, setCodigo] = useState(casa.inviteCode);
  const [confirmandoRotacao, setConfirmandoRotacao] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [pending, startTransition] = useTransition();

  function rotacionar() {
    setErro(null);
    startTransition(async () => {
      const r = await regenerarCodigoAction();
      if (!r.ok) {
        setErro(r.error ?? "Erro.");
        return;
      }
      // Exibe o novo token ANTES de reautenticar: a rotação já invalidou o
      // anterior no backend, então a credencial precisa ficar visível na tela
      // mesmo que o re-login falhe ou rejeite (perda de rede), sob risco de
      // lockout. Só depois renova a sessão para a nova credentialVersion, em
      // try/catch, antes que qualquer navegação caia em requireCasa. (#13)
      setCodigo(r.novoToken);
      setConfirmandoRotacao(false);
      try {
        const login = await signIn("credentials", { token: r.novoToken, redirect: false });
        if (login?.error) {
          setErro("Novo token gerado e exibido acima. A sessão expirou — entre novamente com ele.");
        } else {
          router.refresh();
        }
      } catch {
        setErro("Novo token gerado e exibido acima. A sessão expirou — entre novamente com ele.");
      }
    });
  }

  function excluirConta() {
    setErro(null);
    startTransition(async () => {
      const r = await excluirContaAction();
      if (!r.ok) setErro(r.error ?? "Erro.");
      else await signOut({ callbackUrl: "/login" });
    });
  }

  function executar(acao: () => Promise<Resultado>, depois?: () => void) {
    setErro(null);
    startTransition(async () => {
      const r = await acao();
      if (!r.ok) setErro(r.error ?? "Erro.");
      else depois?.();
    });
  }

  async function copiarCodigo() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      setErro("Não foi possível copiar o código.");
    }
  }

  return (
    <div className="space-y-4 rounded-card border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <KeyRound size={18} className="text-primary-strong" />
        {editandoNome ? (
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            autoFocus
            onBlur={() =>
              executar(() => renomearCasaAction(nome), () => setEditandoNome(false))
            }
            className="flex-1 rounded-lg border border-line px-3 py-1.5 text-lg font-black outline-none focus:border-primary"
          />
        ) : (
          <>
            <h2 className="flex-1 text-lg font-black">{casa.name}</h2>
            <button
              onClick={() => setEditandoNome(true)}
              className="flex items-center gap-1 text-sm font-semibold text-ink-faint hover:text-ink-soft"
            >
              <Pencil size={14} /> Renomear
            </button>
          </>
        )}
      </div>

      {erro && (
        <div className="flex items-center gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm font-medium text-danger">
          <AlertCircle size={16} />
          {erro}
        </div>
      )}

      {/* Token de acesso */}
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-faint">
          Token de acesso
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-xl border border-line bg-bg px-4 py-2.5 text-lg font-black tracking-[0.2em] text-ink">
            {codigo}
          </code>
          <button
            onClick={copiarCodigo}
            title="Copiar"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line text-ink-soft transition hover:bg-bg"
          >
            {copiado ? <Check size={18} className="text-primary" /> : <Copy size={18} />}
          </button>
          <button
            disabled={pending}
            onClick={() => setConfirmandoRotacao((v) => !v)}
            title="Gerar novo token"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line text-ink-soft transition hover:bg-bg disabled:opacity-50"
          >
            <RefreshCw size={18} />
          </button>
        </div>
        {confirmandoRotacao ? (
          <div className="mt-2 space-y-2 rounded-xl bg-amber-soft px-4 py-3">
            <p className="text-sm font-medium text-amber-ink">
              Gerar um novo token <strong>invalida o atual imediatamente</strong> em todos os aparelhos e
              sessões. Você continua conectado aqui e o novo token aparece acima para copiar.
            </p>
            <div className="flex gap-2">
              <button
                disabled={pending}
                onClick={rotacionar}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Gerando..." : "Gerar novo token"}
              </button>
              <button
                disabled={pending}
                onClick={() => setConfirmandoRotacao(false)}
                className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-xs text-ink-faint">
            É o mesmo token do app. Gerar um novo invalida o anterior (será preciso reconectar o app).
          </p>
        )}
      </div>

      {/* Excluir conta */}
      <div className="border-t border-line pt-4">
        {confirmandoExclusao ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">
              Isso apaga a conta e <strong className="font-bold text-ink">todos os dados na nuvem</strong>{" "}
              (produtos, listas, estoque e histórico), para todos os aparelhos conectados a este token. Não há
              como desfazer.
            </p>
            <div className="flex gap-2">
              <button
                disabled={pending}
                onClick={excluirConta}
                className="flex items-center gap-1.5 rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                <Trash2 size={15} strokeWidth={2.2} />
                {pending ? "Excluindo..." : "Excluir definitivamente"}
              </button>
              <button
                disabled={pending}
                onClick={() => setConfirmandoExclusao(false)}
                className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink-soft transition hover:bg-bg disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmandoExclusao(true)}
            className="flex items-center gap-1.5 text-sm font-semibold text-danger transition hover:opacity-80"
          >
            <Trash2 size={15} strokeWidth={2.2} /> Excluir conta
          </button>
        )}
      </div>
    </div>
  );
}
