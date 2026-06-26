"use client";

import { useState, useTransition } from "react";
import { Copy, Check, RefreshCw, Pencil, KeyRound, AlertCircle, Trash2 } from "lucide-react";
import { signOut } from "next-auth/react";
import type { CasaDTO } from "@/server/modules/casa";
import { excluirContaAction, regenerarCodigoAction, renomearCasaAction } from "./actions";

type Resultado = { ok: boolean; error?: string };

export function CasaClient({ casa }: { casa: CasaDTO }) {
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nome, setNome] = useState(casa.name);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [pending, startTransition] = useTransition();

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
      await navigator.clipboard.writeText(casa.inviteCode);
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
            {casa.inviteCode}
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
            onClick={() => executar(() => regenerarCodigoAction())}
            title="Gerar novo token"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line text-ink-soft transition hover:bg-bg disabled:opacity-50"
          >
            <RefreshCw size={18} />
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-faint">
          É o mesmo token do app. Gerar um novo invalida o anterior (será preciso reconectar o app).
        </p>
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
