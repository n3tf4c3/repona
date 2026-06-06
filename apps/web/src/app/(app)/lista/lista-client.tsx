"use client";

import { useState, useTransition } from "react";
import { getNextInventoryQuantity, type ShoppingListItemDTO } from "@repona/core";
import type { GrupoItens } from "@/lib/categorias";
import {
  alternarItemAction,
  atualizarQuantidadeAction,
  removerItemAction,
  finalizarCompraAction,
} from "./actions";

export function ListaClient({
  listName,
  grupos,
  total,
}: {
  listName: string;
  grupos: GrupoItens[];
  total: number;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const todos = grupos.flatMap((g) => g.items);
  const comprados = todos.filter((i) => i.checked).length;
  const progresso = total > 0 ? Math.round((comprados / total) * 100) : 0;

  function executar(acao: () => Promise<{ ok: boolean; error?: string }>) {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      const r = await acao();
      if (!r.ok && r.error) setErro(r.error);
    });
  }

  function finalizar() {
    setErro(null);
    setAviso(null);
    startTransition(async () => {
      const r = await finalizarCompraAction();
      if (!r.ok) {
        setErro(r.error);
      } else if (r.total === 0) {
        setAviso("Marque os itens comprados antes de finalizar.");
      } else {
        setAviso(`Compra finalizada: ${r.total} ${r.total === 1 ? "item" : "itens"} no histórico.`);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#8E9180]">
            {comprados} de {total} comprados
          </p>
          <h1 className="text-2xl font-black tracking-tight">{listName}</h1>
        </div>
        <button
          disabled={pending || total === 0}
          onClick={finalizar}
          className="rounded-xl bg-[#212418] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Finalizar compra
        </button>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-[#E7E5D9]">
        <div className="h-full rounded-full bg-[#2E8B57] transition-all" style={{ width: `${progresso}%` }} />
      </div>

      {erro && (
        <div className="rounded-xl bg-[#FAE1DB] px-4 py-3 text-sm font-medium text-[#B23A2A]">{erro}</div>
      )}
      {aviso && (
        <div className="rounded-xl bg-[#E2F0E5] px-4 py-3 text-sm font-medium text-[#236B43]">{aviso}</div>
      )}

      {total === 0 && (
        <p className="py-10 text-center text-sm text-[#8E9180]">
          Lista vazia. Adicione produtos pela aba <span className="font-semibold">Produtos</span>.
        </p>
      )}

      {grupos.map((grupo) => (
        <div key={grupo.category} className="space-y-2">
          <div className="flex items-center gap-2 pt-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: grupo.color }} />
            <span className="text-sm font-bold text-[#5C604F]">{grupo.category}</span>
            <span className="text-xs text-[#8E9180]">{grupo.items.length}</span>
          </div>
          {grupo.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              pending={pending}
              onToggle={() => executar(() => alternarItemAction(item.id))}
              onQty={(dir) =>
                executar(() =>
                  atualizarQuantidadeAction(item.id, getNextInventoryQuantity(item.quantity, dir))
                )
              }
              onRemove={() => executar(() => removerItemAction(item.id))}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ItemRow({
  item,
  pending,
  onToggle,
  onQty,
  onRemove,
}: {
  item: ShoppingListItemDTO;
  pending: boolean;
  onToggle: () => void;
  onQty: (dir: 1 | -1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#E7E5D9] bg-white p-3">
      <button
        disabled={pending}
        onClick={onToggle}
        aria-label={item.checked ? "Desmarcar" : "Marcar"}
        className={`flex h-6 w-6 items-center justify-center rounded-md border text-sm ${
          item.checked ? "border-[#2E8B57] bg-[#2E8B57] text-white" : "border-[#C9CDBC] bg-white"
        }`}
      >
        {item.checked ? "✓" : ""}
      </button>
      <div className="flex-1">
        <p className={`font-semibold ${item.checked ? "text-[#8E9180] line-through" : ""}`}>
          {item.productName}
        </p>
        {item.productStatus === "missing" && (
          <span className="text-xs font-semibold text-[#B23A2A]">Em falta no estoque</span>
        )}
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-[#E7E5D9] p-1">
        <button
          disabled={pending}
          onClick={() => onQty(-1)}
          className="h-7 w-7 rounded-md text-lg leading-none text-[#5C604F] hover:bg-[#F6F5EF] disabled:opacity-40"
        >
          −
        </button>
        <span className="min-w-14 text-center text-sm font-semibold">{item.quantity}</span>
        <button
          disabled={pending}
          onClick={() => onQty(1)}
          className="h-7 w-7 rounded-md text-lg leading-none text-[#5C604F] hover:bg-[#F6F5EF] disabled:opacity-40"
        >
          +
        </button>
      </div>
      <button
        disabled={pending}
        onClick={onRemove}
        aria-label="Remover"
        className="rounded-lg border border-[#FAE1DB] px-2.5 py-1.5 text-xs font-semibold text-[#B23A2A]"
      >
        ✕
      </button>
    </div>
  );
}
