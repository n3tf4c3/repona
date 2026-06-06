"use client";

import { useState, useTransition } from "react";
import { Copy, Check, RefreshCw, LogOut, Pencil, Users, AlertCircle } from "lucide-react";
import type { CasaDTO } from "@/server/modules/casa";
import {
  entrarComCodigoAction,
  regenerarCodigoAction,
  renomearCasaAction,
  sairDaCasaAction,
} from "./actions";

type Resultado = { ok: boolean; error?: string };

export function CasaClient({ casa, userId }: { casa: CasaDTO; userId: number }) {
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nome, setNome] = useState(casa.name);
  const [codigo, setCodigo] = useState("");
  const [pending, startTransition] = useTransition();

  function executar(acao: () => Promise<Resultado>, depois?: () => void) {
    setErro(null);
    startTransition(async () => {
      const r = await acao();
      if (!r.ok) setErro(r.error ?? "Erro.");
      else depois?.();
    });
  }

  function copiarCodigo() {
    navigator.clipboard?.writeText(casa.inviteCode);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  return (
    <div className="space-y-4 rounded-card border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Users size={18} className="text-primary-strong" />
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

      {/* Código de convite */}
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-faint">
          Código de convite
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
            title="Gerar novo código"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line text-ink-soft transition hover:bg-bg disabled:opacity-50"
          >
            <RefreshCw size={18} />
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-faint">
          Compartilhe com a família. Regenerar invalida o código anterior.
        </p>
      </div>

      {/* Membros */}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-faint">
          Membros ({casa.membros.length})
        </p>
        <div className="space-y-1.5">
          {casa.membros.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl bg-bg px-3 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-sm font-black text-primary-strong">
                {(m.nome || m.email).trim().charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                {m.nome || m.email}
                {m.id === userId && <span className="ml-1 text-xs text-ink-faint">(você)</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Entrar em outra casa */}
      <div className="border-t border-line pt-4">
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-ink-faint">
          Entrar em outra casa
        </p>
        <div className="flex items-center gap-2">
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="Código de convite"
            className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm tracking-[0.15em] outline-none focus:border-primary"
          />
          <button
            disabled={pending || !codigo.trim()}
            onClick={() => executar(() => entrarComCodigoAction(codigo), () => setCodigo(""))}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Entrar
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-faint">
          Você passa a ver a lista e o estoque da outra casa.
        </p>
      </div>

      {/* Sair */}
      <div className="border-t border-line pt-4">
        <button
          disabled={pending}
          onClick={() => {
            if (confirm("Sair da casa? Você irá para uma casa nova e vazia.")) {
              executar(() => sairDaCasaAction());
            }
          }}
          className="flex items-center gap-1.5 text-sm font-semibold text-danger hover:opacity-80 disabled:opacity-50"
        >
          <LogOut size={15} /> Sair desta casa
        </button>
      </div>
    </div>
  );
}
