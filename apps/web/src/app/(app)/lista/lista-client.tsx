"use client";

import { useState, useTransition } from "react";
import { Check, Plus, Minus, Trash2, ShoppingBag, CheckCircle2, AlertCircle, ClipboardList } from "lucide-react";
import { getNextInventoryQuantity, isEmptyQuantity, type ShoppingListItemDTO } from "@repona/core";
import type { GrupoItens } from "@/lib/categorias";
import { CategoriaBolha } from "@/components/categoria-icone";
import { clearOperationId, getOrCreateOperationId } from "@/lib/idempotentMutation";
import { transportErrorMessage, withClientTimeout } from "@/lib/clientAsync";
import {
  alternarItemAction,
  atualizarQuantidadeAction,
  removerItemAction,
  finalizarCompraAction,
} from "./actions";

export function ListaClient({
  listId,
  listName,
  grupos,
  total,
}: {
  listId: number;
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
      try {
        const r = await withClientTimeout(acao());
        if (!r.ok && r.error) setErro(r.error);
      } catch (cause) {
        setErro(transportErrorMessage(cause));
      }
    });
  }

  function finalizar() {
    setErro(null);
    setAviso(null);
    const operationKey = `finalize:${listId}`;
    let operationId: string;
    try {
      operationId = getOrCreateOperationId(
        operationKey,
        window.localStorage,
        () => crypto.randomUUID()
      );
    } catch {
      setErro("Não foi possível preparar a operação. Recarregue a página.");
      return;
    }
    startTransition(async () => {
      try {
        const r = await withClientTimeout(finalizarCompraAction(operationId));
        if (!r.ok) {
          if (r.resetOperation) clearOperationId(operationKey, window.localStorage);
          setErro(r.error);
        } else {
          clearOperationId(operationKey, window.localStorage);
          if (r.total === 0) {
            setAviso("Marque os itens comprados antes de finalizar.");
          } else {
            setAviso(
              `Compra finalizada: ${r.total} ${r.total === 1 ? "item" : "itens"} no histórico.`
            );
          }
        }
      } catch (cause) {
        // A chave permanece no storage: o próximo clique consulta/reaplica a
        // mesma operação sem duplicar efeitos após uma resposta perdida.
        setErro(transportErrorMessage(cause));
      }
    });
  }

  function proximaQuantidadeCompra(quantity: string, dir: 1 | -1) {
    const next = getNextInventoryQuantity(quantity, dir);
    return isEmptyQuantity(next) ? quantity : next;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-ink-faint">
            {comprados} de {total} comprados
          </p>
          <h1 className="text-2xl font-black tracking-tight">{listName}</h1>
        </div>
        <button
          disabled={pending || total === 0}
          onClick={finalizar}
          className="flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
        >
          <ShoppingBag size={16} strokeWidth={2.4} />
          Finalizar
        </button>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progresso}%` }} />
      </div>

      {erro && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm font-medium text-danger">
          <AlertCircle size={16} />
          {erro}
        </div>
      )}
      {aviso && (
        <div className="flex items-center gap-2 rounded-xl bg-primary-soft px-4 py-3 text-sm font-medium text-primary-strong">
          <CheckCircle2 size={16} />
          {aviso}
        </div>
      )}

      {total === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line py-12 text-center text-ink-faint">
          <ClipboardList size={32} strokeWidth={1.6} />
          <p className="text-sm">
            Lista vazia. Adicione produtos pela aba <span className="font-semibold">Produtos</span>.
          </p>
        </div>
      )}

      {grupos.map((grupo) => (
        <div key={grupo.category} className="space-y-2">
          <div className="flex items-center gap-2 pt-2">
            <CategoriaBolha category={grupo.category} size={26} />
            <span className="text-sm font-bold text-ink-soft">{grupo.category}</span>
            <span className="text-xs text-ink-faint">{grupo.items.length}</span>
          </div>
          {grupo.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              pending={pending}
              onToggle={() => executar(() => alternarItemAction(item.id))}
              onQty={(dir) =>
                executar(() =>
                  atualizarQuantidadeAction(item.id, proximaQuantidadeCompra(item.quantity, dir))
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
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-3">
      <button
        disabled={pending}
        onClick={onToggle}
        aria-label={item.checked ? "Desmarcar" : "Marcar"}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition ${
          item.checked ? "border-primary bg-primary text-white" : "border-ink-faint/50 bg-surface"
        }`}
      >
        {item.checked && <Check size={15} strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`truncate font-semibold ${item.checked ? "text-ink-faint line-through" : ""}`}>
          {item.productName}
        </p>
        {item.productStatus === "missing" && (
          <span className="text-xs font-semibold text-danger">Em falta no estoque</span>
        )}
      </div>
      <div className="flex items-center gap-1 rounded-lg border border-line p-1">
        <button
          disabled={pending}
          onClick={() => onQty(-1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-bg disabled:opacity-40"
          aria-label="Diminuir"
        >
          <Minus size={16} />
        </button>
        <span className="min-w-14 text-center text-sm font-semibold tabular-nums">{item.quantity}</span>
        <button
          disabled={pending}
          onClick={() => onQty(1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-bg disabled:opacity-40"
          aria-label="Aumentar"
        >
          <Plus size={16} />
        </button>
      </div>
      <button
        disabled={pending}
        onClick={onRemove}
        aria-label="Remover"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-coral-soft text-danger transition hover:bg-coral-soft disabled:opacity-40"
      >
        <Trash2 size={15} strokeWidth={2.2} />
      </button>
    </div>
  );
}
