"use client";

import { useMemo, useState, useTransition } from "react";
import { getNextInventoryQuantity, type ProductDTO, type NewProductInput } from "@repona/core";
import { corDaCategoria, CATEGORIAS } from "@/lib/categorias";
import {
  criarProdutoAction,
  atualizarProdutoAction,
  excluirProdutoAction,
  definirQuantidadeAction,
  marcarEmFaltaAction,
  consumirAction,
  adicionarAListaAction,
} from "./actions";

type Resultado = { ok: true } | { ok: false; error: string };

export function ProdutosClient({ produtos }: { produtos: ProductDTO[] }) {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("Todos");
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<ProductDTO | null>(null);
  const [criando, setCriando] = useState(false);
  const [pending, startTransition] = useTransition();

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      const casaBusca = !termo || p.name.toLowerCase().includes(termo);
      const casaCategoria = categoria === "Todos" || p.category === categoria;
      return casaBusca && casaCategoria;
    });
  }, [produtos, busca, categoria]);

  function executar(acao: () => Promise<Resultado>) {
    setErro(null);
    startTransition(async () => {
      const r = await acao();
      if (!r.ok) setErro(r.error);
    });
  }

  const chips = ["Todos", ...CATEGORIAS];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#8E9180]">Catálogo da casa</p>
          <h1 className="text-2xl font-black tracking-tight">Produtos</h1>
        </div>
        <button
          onClick={() => {
            setCriando(true);
            setEditando(null);
          }}
          className="rounded-xl bg-[#212418] px-4 py-2 text-sm font-semibold text-white"
        >
          + Novo produto
        </button>
      </div>

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar produto..."
        className="w-full rounded-xl border border-[#E7E5D9] bg-white px-4 py-3 text-sm outline-none focus:border-[#2E8B57]"
      />

      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip}
            onClick={() => setCategoria(chip)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
              categoria === chip
                ? "bg-[#2E8B57] text-white"
                : "bg-white text-[#5C604F] border border-[#E7E5D9]"
            }`}
          >
            {chip}
          </button>
        ))}
      </div>

      {erro && (
        <div className="rounded-xl bg-[#FAE1DB] px-4 py-3 text-sm font-medium text-[#B23A2A]">
          {erro}
        </div>
      )}

      <div className="space-y-3">
        {filtrados.length === 0 && (
          <p className="py-8 text-center text-sm text-[#8E9180]">Nenhum produto encontrado.</p>
        )}
        {filtrados.map((produto) => (
          <ProductCard
            key={produto.id}
            produto={produto}
            pending={pending}
            onAddLista={() => executar(() => adicionarAListaAction(produto.id))}
            onEditar={() => {
              setEditando(produto);
              setCriando(false);
            }}
            onExcluir={() => executar(() => excluirProdutoAction(produto.id))}
            onStock={(dir) =>
              executar(() =>
                definirQuantidadeAction(produto.id, getNextInventoryQuantity(produto.inventoryQuantity, dir))
              )
            }
            onFalta={() => executar(() => marcarEmFaltaAction(produto.id))}
            onConsumir={() => executar(() => consumirAction(produto.id))}
          />
        ))}
      </div>

      {(criando || editando) && (
        <ProdutoModal
          produto={editando}
          pending={pending}
          onFechar={() => {
            setCriando(false);
            setEditando(null);
            setErro(null);
          }}
          onSalvar={(input) =>
            executar(async () => {
              const r = editando
                ? await atualizarProdutoAction(editando.id, input)
                : await criarProdutoAction(input);
              if (r.ok) {
                setCriando(false);
                setEditando(null);
              }
              return r;
            })
          }
        />
      )}
    </div>
  );
}

function ProductCard({
  produto,
  pending,
  onAddLista,
  onEditar,
  onExcluir,
  onStock,
  onFalta,
  onConsumir,
}: {
  produto: ProductDTO;
  pending: boolean;
  onAddLista: () => void;
  onEditar: () => void;
  onExcluir: () => void;
  onStock: (dir: 1 | -1) => void;
  onFalta: () => void;
  onConsumir: () => void;
}) {
  const emFalta = produto.inventoryStatus === "missing";
  return (
    <div className="rounded-2xl border border-[#E7E5D9] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="mt-1 inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: corDaCategoria(produto.category) }}
          />
          <div>
            <p className="font-bold">{produto.name}</p>
            <p className="text-xs text-[#8E9180]">
              {produto.category} · comprado {produto.purchaseCount}x
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            emFalta ? "bg-[#FAE1DB] text-[#B23A2A]" : "bg-[#E2F0E5] text-[#236B43]"
          }`}
        >
          {emFalta ? "Em falta" : "Em estoque"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-[#E7E5D9] p-1">
          <button
            disabled={pending}
            onClick={() => onStock(-1)}
            className="h-7 w-7 rounded-md text-lg leading-none text-[#5C604F] hover:bg-[#F6F5EF] disabled:opacity-40"
          >
            −
          </button>
          <span className="min-w-16 text-center text-sm font-semibold">{produto.inventoryQuantity}</span>
          <button
            disabled={pending}
            onClick={() => onStock(1)}
            className="h-7 w-7 rounded-md text-lg leading-none text-[#5C604F] hover:bg-[#F6F5EF] disabled:opacity-40"
          >
            +
          </button>
        </div>

        <button
          disabled={pending}
          onClick={onAddLista}
          className="rounded-lg bg-[#2E8B57] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          + Lista
        </button>
        <button
          disabled={pending || emFalta}
          onClick={onConsumir}
          className="rounded-lg border border-[#E7E5D9] px-3 py-1.5 text-xs font-semibold text-[#5C604F] disabled:opacity-40"
        >
          Consumir
        </button>
        <button
          disabled={pending || emFalta}
          onClick={onFalta}
          className="rounded-lg border border-[#E7E5D9] px-3 py-1.5 text-xs font-semibold text-[#5C604F] disabled:opacity-40"
        >
          Em falta
        </button>
        <div className="ml-auto flex gap-2">
          <button
            disabled={pending}
            onClick={onEditar}
            className="rounded-lg border border-[#E7E5D9] px-3 py-1.5 text-xs font-semibold text-[#5C604F]"
          >
            Editar
          </button>
          <button
            disabled={pending}
            onClick={onExcluir}
            className="rounded-lg border border-[#FAE1DB] px-3 py-1.5 text-xs font-semibold text-[#B23A2A]"
          >
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}

function ProdutoModal({
  produto,
  pending,
  onFechar,
  onSalvar,
}: {
  produto: ProductDTO | null;
  pending: boolean;
  onFechar: () => void;
  onSalvar: (input: NewProductInput) => void;
}) {
  const [name, setName] = useState(produto?.name ?? "");
  const [category, setCategory] = useState(produto?.category ?? CATEGORIAS[0]);
  const [alertThreshold, setAlertThreshold] = useState(produto?.alertThreshold ?? "");

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-black">{produto ? "Editar produto" : "Novo produto"}</h2>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-semibold text-[#5C604F]">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#E7E5D9] px-4 py-2.5 text-sm outline-none focus:border-[#2E8B57]"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-[#5C604F]">Categoria</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-xl border border-[#E7E5D9] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#2E8B57]"
            >
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-[#5C604F]">Alerta de estoque baixo (opcional)</span>
            <input
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(e.target.value)}
              placeholder="ex.: 1 un"
              className="mt-1 w-full rounded-xl border border-[#E7E5D9] px-4 py-2.5 text-sm outline-none focus:border-[#2E8B57]"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onFechar}
            className="rounded-xl border border-[#E7E5D9] px-4 py-2 text-sm font-semibold text-[#5C604F]"
          >
            Cancelar
          </button>
          <button
            disabled={pending}
            onClick={() => onSalvar({ name, category, alertThreshold })}
            className="rounded-xl bg-[#2E8B57] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
