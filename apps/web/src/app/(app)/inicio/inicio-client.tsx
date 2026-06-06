"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { InventoryAlert, RebuySuggestion, ProductDTO } from "@repona/core";
import { corDaCategoria } from "@/lib/categorias";
import { adicionarAListaAction } from "../produtos/actions";

export function InicioClient({
  listName,
  total,
  comprados,
  alertas,
  sugestao,
  costuma,
}: {
  listName: string;
  total: number;
  comprados: number;
  alertas: InventoryAlert[];
  sugestao: RebuySuggestion | null;
  costuma: ProductDTO[];
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const progresso = total > 0 ? Math.round((comprados / total) * 100) : 0;

  function adicionar(produtoId: number) {
    setErro(null);
    startTransition(async () => {
      const r = await adicionarAListaAction(produtoId);
      if (!r.ok) setErro(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-[#8E9180]">Sua casa</p>
        <h1 className="text-2xl font-black tracking-tight">Início</h1>
      </div>

      {erro && (
        <div className="rounded-xl bg-[#FAE1DB] px-4 py-3 text-sm font-medium text-[#B23A2A]">{erro}</div>
      )}

      {/* Lista ativa */}
      <Link
        href="/lista"
        className="block rounded-2xl border border-[#E7E5D9] bg-white p-5 shadow-sm transition hover:border-[#2E8B57]"
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="rounded-full bg-[#E2F0E5] px-2 py-0.5 text-xs font-bold text-[#236B43]">
              Lista ativa
            </span>
            <p className="mt-2 text-lg font-black">{listName}</p>
            <p className="text-sm text-[#8E9180]">
              {comprados} de {total} itens comprados
            </p>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-[#E2F0E5] text-sm font-black text-[#236B43]">
            {progresso}%
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#E7E5D9]">
          <div className="h-full rounded-full bg-[#2E8B57]" style={{ width: `${progresso}%` }} />
        </div>
      </Link>

      {/* Ações rápidas */}
      <div className="grid grid-cols-3 gap-3">
        <QuickAction href="/produtos" label="Produtos" />
        <QuickAction href="/lista" label="Lista" />
        <QuickAction href="/historico" label="Histórico" />
      </div>

      {/* Alertas de estoque */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-[#5C604F]">Alertas de estoque</h2>
        {alertas.length === 0 ? (
          <p className="rounded-2xl border border-[#E7E5D9] bg-white p-4 text-sm text-[#8E9180]">
            Tudo certo por aqui — nenhum produto em falta ou com estoque baixo.
          </p>
        ) : (
          <div className="space-y-2">
            {alertas.map((alerta) => (
              <div
                key={alerta.id}
                className="flex items-center gap-3 rounded-2xl border border-[#E7E5D9] bg-white p-4"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: corDaCategoria(alerta.product.category) }}
                />
                <div className="flex-1">
                  <p className="font-bold">{alerta.product.name}</p>
                  <p className="text-xs text-[#8E9180]">{alerta.description}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    alerta.level === "missing"
                      ? "bg-[#FAE1DB] text-[#B23A2A]"
                      : "bg-[#FBEAD4] text-[#9A6314]"
                  }`}
                >
                  {alerta.label}
                </span>
                <button
                  disabled={pending}
                  onClick={() => adicionar(alerta.product.id)}
                  className="rounded-lg bg-[#2E8B57] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  + Lista
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sugestão de recompra */}
      {sugestao && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-[#5C604F]">Sugestão para você</h2>
          <div className="rounded-2xl border border-[#E7E5D9] bg-[#F0F7F0] p-5">
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-[#236B43]">
              {sugestao.badge}
            </span>
            <p className="mt-2 text-lg font-black">{sugestao.title}</p>
            <p className="text-sm text-[#5C604F]">{sugestao.description}</p>
            <button
              disabled={pending}
              onClick={() => adicionar(sugestao.product.id)}
              className="mt-3 rounded-xl bg-[#212418] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              + Adicionar à lista
            </button>
          </div>
        </section>
      )}

      {/* Você costuma comprar */}
      {costuma.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold text-[#5C604F]">Você costuma comprar</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {costuma.map((produto) => (
              <div
                key={produto.id}
                className="flex flex-col gap-2 rounded-2xl border border-[#E7E5D9] bg-white p-4"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: corDaCategoria(produto.category) }}
                />
                <p className="text-sm font-bold leading-tight">{produto.name}</p>
                <p className="text-xs text-[#8E9180]">comprado {produto.purchaseCount}x</p>
                <button
                  disabled={pending}
                  onClick={() => adicionar(produto.id)}
                  className="mt-auto rounded-lg border border-[#2E8B57] px-3 py-1.5 text-xs font-semibold text-[#236B43] disabled:opacity-50"
                >
                  + Lista
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-2xl border border-[#E7E5D9] bg-white p-4 text-center text-sm font-semibold text-[#5C604F] transition hover:border-[#2E8B57]"
    >
      {label}
    </Link>
  );
}
