"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Plus,
  Package,
  ListChecks,
  History,
  Sparkles,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import type { InventoryAlert, RebuySuggestion, ProductDTO } from "@repona/core";
import { CategoriaBolha } from "@/components/categoria-icone";
import { transportErrorMessage, withClientTimeout } from "@/lib/clientAsync";
import { adicionarAListaAction } from "../produtos/actions";

export function InicioClient({
  listName,
  total,
  comprados,
  alertas,
  sugestoes,
  costuma,
}: {
  listName: string;
  total: number;
  comprados: number;
  alertas: InventoryAlert[];
  sugestoes: RebuySuggestion[];
  costuma: ProductDTO[];
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const progresso = total > 0 ? Math.round((comprados / total) * 100) : 0;

  function adicionar(produtoId: number) {
    setErro(null);
    startTransition(async () => {
      try {
        const r = await withClientTimeout(adicionarAListaAction(produtoId));
        if (!r.ok) setErro(r.error);
      } catch (cause) {
        setErro(transportErrorMessage(cause));
      }
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-ink-faint">Sua casa</p>
        <h1 className="text-2xl font-black tracking-tight">Início</h1>
      </div>

      {erro && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm font-medium text-danger">
          <AlertCircle size={16} />
          {erro}
        </div>
      )}

      {/* Lista ativa */}
      <Link
        href="/lista"
        className="group block rounded-card border border-line bg-surface p-5 shadow-sm transition hover:border-primary"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary-strong">
              Lista ativa
            </span>
            <p className="mt-2 truncate text-lg font-black">{listName}</p>
            <p className="text-sm text-ink-faint">
              {comprados} de {total} itens comprados
            </p>
          </div>
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
            <svg className="h-16 w-16 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" fill="none" className="stroke-line" strokeWidth="3" />
              <circle
                cx="18"
                cy="18"
                r="16"
                fill="none"
                className="stroke-primary"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(progresso / 100) * 100.5} 100.5`}
              />
            </svg>
            <span className="absolute text-sm font-black text-primary-strong">{progresso}%</span>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end text-sm font-semibold text-primary-strong">
          Abrir lista <ArrowRight size={16} className="ml-1 transition group-hover:translate-x-0.5" />
        </div>
      </Link>

      {/* Ações rápidas */}
      <div className="grid grid-cols-3 gap-3">
        <QuickAction href="/produtos" label="Produtos" Icon={Package} />
        <QuickAction href="/lista" label="Lista" Icon={ListChecks} />
        <QuickAction href="/historico" label="Histórico" Icon={History} />
      </div>

      {/* Alertas de estoque */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-ink-soft">Alertas de estoque</h2>
        {alertas.length === 0 ? (
          <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-4 text-sm text-ink-faint">
            <CheckCircle2 size={20} className="text-primary" />
            Tudo certo — nenhum produto em falta ou com estoque baixo.
          </div>
        ) : (
          <div className="space-y-2">
            {alertas.map((alerta) => (
              <div key={alerta.id} className="flex items-center gap-3 rounded-card border border-line bg-surface p-4">
                <CategoriaBolha category={alerta.product.category} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{alerta.product.name}</p>
                  <p className="truncate text-xs text-ink-faint">{alerta.description}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
                    alerta.level === "missing" ? "bg-coral-soft text-danger" : "bg-amber-soft text-amber-ink"
                  }`}
                >
                  {alerta.label}
                </span>
                <button
                  disabled={pending}
                  onClick={() => adicionar(alerta.product.id)}
                  aria-label="Adicionar à lista"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  <Plus size={16} strokeWidth={2.6} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sugestões de recompra */}
      {sugestoes.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-ink-soft">Sugestões de recompra</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sugestoes.map((sugestao, idx) => (
              <div key={sugestao.product.id ?? idx} className="flex flex-col justify-between rounded-card border border-line bg-primary-tint p-4">
                <div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-xs font-bold text-primary-strong">
                    <Sparkles size={12} />
                    {sugestao.badge}
                  </span>
                  <p className="mt-2 text-base font-black">{sugestao.title}</p>
                  <p className="text-xs text-ink-soft">{sugestao.description}</p>
                </div>
                <button
                  disabled={pending}
                  onClick={() => adicionar(sugestao.product.id)}
                  className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  <Plus size={14} strokeWidth={2.6} />
                  Adicionar à lista
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Você costuma comprar */}
      {costuma.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-ink-soft">Você costuma comprar</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {costuma.map((produto) => (
              <div key={produto.id} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
                <CategoriaBolha category={produto.category} size={36} />
                <p className="text-sm font-bold leading-tight">{produto.name}</p>
                <p className="text-xs text-ink-faint">comprado {produto.purchaseCount}x</p>
                <button
                  disabled={pending}
                  onClick={() => adicionar(produto.id)}
                  className="mt-auto flex items-center justify-center gap-1 rounded-lg border border-primary px-3 py-1.5 text-xs font-semibold text-primary-strong transition hover:bg-primary-soft disabled:opacity-50"
                >
                  <Plus size={14} strokeWidth={2.6} /> Lista
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function QuickAction({
  href,
  label,
  Icon,
}: {
  href: string;
  label: string;
  Icon: typeof Package;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 rounded-card border border-line bg-surface p-4 text-sm font-semibold text-ink-soft transition hover:border-primary hover:text-primary-strong"
    >
      <Icon size={22} strokeWidth={2.2} />
      {label}
    </Link>
  );
}
