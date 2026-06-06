"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Search,
  Plus,
  Minus,
  Pencil,
  Trash2,
  ShoppingCart,
  Utensils,
  PackageX,
  AlertCircle,
  PackageOpen,
} from "lucide-react";
import { getNextInventoryQuantity, type ProductDTO, type NewProductInput } from "@repona/core";
import { CATEGORIAS } from "@/lib/categorias";
import { CategoriaBolha } from "@/components/categoria-icone";
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-ink-faint">Catálogo da casa</p>
          <h1 className="text-2xl font-black tracking-tight">Produtos</h1>
        </div>
        <button
          onClick={() => {
            setCriando(true);
            setEditando(null);
          }}
          className="flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          <Plus size={16} strokeWidth={2.6} />
          Novo
        </button>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto..."
          className="w-full rounded-xl border border-line bg-surface py-3 pl-10 pr-4 text-sm outline-none transition focus:border-primary"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <button
            key={chip}
            onClick={() => setCategoria(chip)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
              categoria === chip
                ? "bg-primary text-white"
                : "border border-line bg-surface text-ink-soft hover:border-primary"
            }`}
          >
            {chip}
          </button>
        ))}
      </div>

      {erro && (
        <div className="flex items-center gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm font-medium text-danger">
          <AlertCircle size={16} />
          {erro}
        </div>
      )}

      <div className="space-y-3">
        {filtrados.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line py-12 text-center text-ink-faint">
            <PackageOpen size={32} strokeWidth={1.6} />
            <p className="text-sm">Nenhum produto encontrado.</p>
          </div>
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
    <div className="rounded-card border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <CategoriaBolha category={produto.category} />
          <div>
            <p className="font-bold leading-tight">{produto.name}</p>
            <p className="text-xs text-ink-faint">
              {produto.category} · comprado {produto.purchaseCount}x
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${
            emFalta ? "bg-coral-soft text-danger" : "bg-primary-soft text-primary-strong"
          }`}
        >
          {emFalta ? "Em falta" : "Em estoque"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Stepper value={produto.inventoryQuantity} pending={pending} onStep={onStock} />

        <IconButton label="Adicionar à lista" pending={pending} onClick={onAddLista} variant="primary">
          <ShoppingCart size={15} strokeWidth={2.4} />
        </IconButton>
        <IconButton label="Consumir" pending={pending || emFalta} onClick={onConsumir}>
          <Utensils size={15} strokeWidth={2.2} />
        </IconButton>
        <IconButton label="Marcar em falta" pending={pending || emFalta} onClick={onFalta}>
          <PackageX size={15} strokeWidth={2.2} />
        </IconButton>
        <div className="ml-auto flex gap-2">
          <IconButton label="Editar" pending={pending} onClick={onEditar}>
            <Pencil size={15} strokeWidth={2.2} />
          </IconButton>
          <IconButton label="Excluir" pending={pending} onClick={onExcluir} variant="danger">
            <Trash2 size={15} strokeWidth={2.2} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function Stepper({
  value,
  pending,
  onStep,
}: {
  value: string;
  pending: boolean;
  onStep: (dir: 1 | -1) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line p-1">
      <button
        disabled={pending}
        onClick={() => onStep(-1)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-bg disabled:opacity-40"
        aria-label="Diminuir"
      >
        <Minus size={16} />
      </button>
      <span className="min-w-16 text-center text-sm font-semibold tabular-nums">{value}</span>
      <button
        disabled={pending}
        onClick={() => onStep(1)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition hover:bg-bg disabled:opacity-40"
        aria-label="Aumentar"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

function IconButton({
  children,
  label,
  pending,
  onClick,
  variant = "neutral",
}: {
  children: React.ReactNode;
  label: string;
  pending: boolean;
  onClick: () => void;
  variant?: "neutral" | "primary" | "danger";
}) {
  const estilos = {
    neutral: "border border-line text-ink-soft hover:bg-bg",
    primary: "bg-primary text-white hover:opacity-90",
    danger: "border border-coral-soft text-danger hover:bg-coral-soft",
  }[variant];
  return (
    <button
      disabled={pending}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition disabled:opacity-40 ${estilos}`}
    >
      {children}
    </button>
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
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-ink/30 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-card bg-surface p-5 shadow-xl">
        <h2 className="text-lg font-black">{produto ? "Editar produto" : "Novo produto"}</h2>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-semibold text-ink-soft">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="mt-1 w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none transition focus:border-primary"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink-soft">Categoria</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none transition focus:border-primary"
            >
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-ink-soft">Alerta de estoque baixo (opcional)</span>
            <input
              value={alertThreshold}
              onChange={(e) => setAlertThreshold(e.target.value)}
              placeholder="ex.: 1 un"
              className="mt-1 w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none transition focus:border-primary"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onFechar}
            className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-bg"
          >
            Cancelar
          </button>
          <button
            disabled={pending}
            onClick={() => onSalvar({ name, category, alertThreshold })}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
