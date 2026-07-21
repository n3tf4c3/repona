"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, RefreshCw, Pencil, KeyRound, AlertCircle, Trash2 } from "lucide-react";
import { signIn, signOut } from "next-auth/react";
import { isLegacyCasaCode } from "@repona/core";
import type { CasaDTO } from "@/server/modules/casa";
import { transportErrorMessage, withClientTimeout } from "@/lib/clientAsync";
import {
  acknowledgeTokenRotation,
  requestTokenRotation,
  TokenRotationError,
} from "@/lib/tokenRotation";
import { excluirContaAction, renomearCasaAction } from "./actions";

type Resultado = { ok: boolean; error?: string };

export function CasaClient({
  casa,
  tokenAtualizado = false,
}: {
  casa: CasaDTO;
  tokenAtualizado?: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nome, setNome] = useState(casa.name);
  const [codigo, setCodigo] = useState(casa.inviteCode);
  const [confirmandoRotacao, setConfirmandoRotacao] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [pending, startTransition] = useTransition();
  const legacyToken = isLegacyCasaCode(codigo);

  function rotacionar() {
    setErro(null);
    startTransition(async () => {
      let tokenWasRotated = false;
      const mode = legacyToken ? "migrate" : "rotate";
      try {
        const r = await requestTokenRotation(
          codigo,
          mode,
          window.localStorage
        );
        // Exibe o novo token ANTES de reautenticar: a rotação já invalidou o
        // anterior no backend, então a credencial precisa ficar visível na tela
        // mesmo que o re-login falhe ou rejeite (perda de rede), sob risco de
        // lockout. Só depois renova a sessão para a nova credentialVersion. (#13)
        setCodigo(r.token);
        tokenWasRotated = true;
        setConfirmandoRotacao(false);
        if (r.casaId !== casa.id) {
          setErro(
            "O token recuperado pertence a outra operação pendente. Ele foi exibido para não ser perdido; a sessão não foi trocada."
          );
          return;
        }
        const login = await withClientTimeout(
          signIn("credentials", { token: r.token, redirect: false })
        );
        if (login?.ok !== true) {
          setErro("Novo token gerado e exibido acima. A sessão expirou — entre novamente com ele.");
        } else {
          acknowledgeTokenRotation(r.operation, window.localStorage);
          router.refresh();
        }
      } catch (cause) {
        const rotationMessage =
          cause instanceof TokenRotationError && cause.code === "LEGACY_TOKEN_MIGRATION_EXPIRED"
            ? "O prazo de migração automática terminou. Procure a recuperação operacional da conta."
            : cause instanceof TokenRotationError && cause.code === "PENDING_ROTATION_RECOVERY"
              ? "Há uma atualização pendente sem resultado confirmado. Por segurança, use a recuperação operacional da conta."
              : cause instanceof TokenRotationError && cause.code === "PENDING_TOKEN_ROTATION"
                ? "A atualização pendente pertence a outro token. Reabra a tentativa original."
            : cause instanceof TokenRotationError && cause.code === "IDEMPOTENCY_CONFLICT"
              ? "A tentativa pendente não corresponde a este token. Tente novamente."
              : transportErrorMessage(cause);
        setErro(
          tokenWasRotated
            ? "Novo token gerado e exibido acima. A sessão expirou — entre novamente com ele."
            : rotationMessage
        );
      }
    });
  }

  function excluirConta() {
    setErro(null);
    startTransition(async () => {
      try {
        const r = await withClientTimeout(excluirContaAction());
        if (!r.ok) setErro(r.error ?? "Erro.");
        else await withClientTimeout(signOut({ callbackUrl: "/login" }));
      } catch (cause) {
        setErro(transportErrorMessage(cause));
      }
    });
  }

  function executar(acao: () => Promise<Resultado>, depois?: () => void) {
    setErro(null);
    startTransition(async () => {
      try {
        const r = await withClientTimeout(acao());
        if (!r.ok) setErro(r.error ?? "Erro.");
        else depois?.();
      } catch (cause) {
        setErro(transportErrorMessage(cause));
      }
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
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm font-medium text-danger">
          <AlertCircle size={16} />
          {erro}
        </div>
      )}

      {tokenAtualizado && !erro && (
        <div role="status" className="rounded-xl bg-amber-soft px-4 py-3 text-sm font-medium text-amber-ink">
          Seu token foi atualizado. Copie e guarde a credencial exibida abaixo antes de sair.
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
            aria-label="Copiar código"
            title="Copiar"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line text-ink-soft transition hover:bg-bg"
          >
            {copiado ? <Check size={18} className="text-primary" /> : <Copy size={18} />}
          </button>
          <button
            disabled={pending}
            onClick={() => setConfirmandoRotacao((v) => !v)}
            aria-label={legacyToken ? "Atualizar token legado" : "Gerar novo token"}
            title={legacyToken ? "Atualizar token legado" : "Gerar novo token"}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line text-ink-soft transition hover:bg-bg disabled:opacity-50"
          >
            <RefreshCw size={18} />
          </button>
        </div>
        {confirmandoRotacao ? (
          <div className="mt-2 space-y-2 rounded-xl bg-amber-soft px-4 py-3">
            <p className="text-sm font-medium text-amber-ink">
              {legacyToken ? (
                <>
                  Este token curto precisa ser atualizado. O novo token aparece acima e o anterior
                  serve apenas para atualizar os outros aparelhos durante uma janela limitada.
                </>
              ) : (
                <>
                  Gerar um novo token <strong>invalida o atual imediatamente</strong> em todos os
                  aparelhos e sessões. Você continua conectado aqui e o novo token aparece acima.
                </>
              )}
            </p>
            <div className="flex gap-2">
              <button
                disabled={pending}
                onClick={rotacionar}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Atualizando..." : legacyToken ? "Atualizar token" : "Gerar novo token"}
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
        ) : legacyToken ? (
          <div className="mt-2 rounded-xl bg-amber-soft px-4 py-3 text-sm font-medium text-amber-ink">
            Token legado de {codigo.length} caracteres. Atualize-o antes de{" "}
            {new Date(casa.legacyTokenAcceptUntil).toLocaleDateString("pt-BR")}. Depois de{" "}
            {new Date(casa.legacyMigrationHardEnd).toLocaleDateString("pt-BR")}, somente a
            recuperação operacional poderá restaurar o acesso.
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
