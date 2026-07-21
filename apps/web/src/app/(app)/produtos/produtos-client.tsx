"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  Archive,
  ArchiveRestore,
  TrendingUp,
  TrendingDown,
  X,
} from "lucide-react";
import {
  getNextInventoryQuantity,
  summarizePrices,
  type PricePoint,
  type ProductDTO,
  type NewProductInput,
} from "@repona/core";
import { CATEGORIAS } from "@/lib/categorias";
import { formatCentsBRL } from "@/lib/preco";
import { CategoriaBolha } from "@/components/categoria-icone";
import {
  criarProdutoAction,
  atualizarProdutoAction,
  excluirProdutoAction,
  desarquivarProdutoAction,
  definirQuantidadeAction,
  marcarEmFaltaAction,
  consumirAction,
  adicionarAListaAction,
} from "./actions";

type Resultado = { ok: true; arquivado?: boolean } | { ok: false; error: string };

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true"
  );
}

/** Mantém teclado/leitor de tela dentro do modal e devolve foco ao acionador. */
function useAccessibleDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const initialFocus =
        dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]") ??
        getFocusableElements(dialog)[0] ??
        dialog;
      initialFocus.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeRef.current();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return { dialogRef, onKeyDown };
}

export function ProdutosClient({
  produtos,
  arquivados,
  precos,
}: {
  produtos: ProductDTO[];
  arquivados: ProductDTO[];
  precos: Record<number, PricePoint[]>;
}) {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("Todos");
  const [verArquivados, setVerArquivados] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<ProductDTO | null>(null);
  const [criando, setCriando] = useState(false);
  const [vendoPrecos, setVendoPrecos] = useState<ProductDTO | null>(null);
  const [pending, startTransition] = useTransition();

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const base = verArquivados ? arquivados : produtos;
    return base.filter((p) => {
      const casaBusca =
        !termo ||
        p.name.toLowerCase().includes(termo) ||
        (p.barcode?.toLowerCase().includes(termo) ?? false);
      const casaCategoria = categoria === "Todos" || p.category === categoria;
      return casaBusca && casaCategoria;
    });
  }, [produtos, arquivados, verArquivados, busca, categoria]);

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
          className="flex min-h-11 items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
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
          aria-label="Buscar produtos por nome ou código"
          className="w-full rounded-xl border border-line bg-surface py-3 pl-10 pr-4 text-sm outline-none transition focus:border-primary"
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por categoria">
        {chips.map((chip) => (
          <button
            key={chip}
            onClick={() => setCategoria(chip)}
            aria-pressed={categoria === chip}
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

      {arquivados.length > 0 && (
        <button
          onClick={() => setVerArquivados((v) => !v)}
          aria-pressed={verArquivados}
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
            verArquivados
              ? "bg-ink text-white"
              : "border border-line bg-surface text-ink-soft hover:border-primary"
          }`}
        >
          <Archive size={15} strokeWidth={2.2} />
          {verArquivados ? "Mostrando arquivados" : `Mostrar arquivados (${arquivados.length})`}
        </button>
      )}

      {erro && !(criando || editando) && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm font-medium text-danger">
          <AlertCircle size={16} />
          {erro}
        </div>
      )}

      <div className="space-y-3">
        {filtrados.length === 0 && (
          <div role="status" className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line py-12 text-center text-ink-faint">
            <PackageOpen size={32} strokeWidth={1.6} />
            <p className="text-sm">
              {verArquivados ? "Nenhum produto arquivado." : "Nenhum produto encontrado."}
            </p>
          </div>
        )}
        {verArquivados
          ? filtrados.map((produto) => (
              <ArchivedCard
                key={produto.id}
                produto={produto}
                pending={pending}
                onDesarquivar={() => executar(() => desarquivarProdutoAction(produto.id))}
              />
            ))
          : filtrados.map((produto) => (
              <ProductCard
                key={produto.id}
                produto={produto}
                pontosPreco={precos[produto.id] ?? []}
                pending={pending}
                onVerPrecos={() => setVendoPrecos(produto)}
                onAddLista={() => executar(() => adicionarAListaAction(produto.id))}
                onEditar={() => {
                  setEditando(produto);
                  setCriando(false);
                }}
                onExcluir={() => {
                  if (window.confirm(`Remover ${produto.name}?\n\nO produto será arquivado (some do catálogo; histórico e preços preservados).`))
                    executar(() => excluirProdutoAction(produto.id));
                }}
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

      {vendoPrecos && (
        <PrecoModal
          produto={vendoPrecos}
          pontos={precos[vendoPrecos.id] ?? []}
          onFechar={() => setVendoPrecos(null)}
        />
      )}

      {(criando || editando) && (
        <ProdutoModal
          produto={editando}
          erro={erro}
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
  pontosPreco,
  pending,
  onVerPrecos,
  onAddLista,
  onEditar,
  onExcluir,
  onStock,
  onFalta,
  onConsumir,
}: {
  produto: ProductDTO;
  pontosPreco: PricePoint[];
  pending: boolean;
  onVerPrecos: () => void;
  onAddLista: () => void;
  onEditar: () => void;
  onExcluir: () => void;
  onStock: (dir: 1 | -1) => void;
  onFalta: () => void;
  onConsumir: () => void;
}) {
  const emFalta = produto.inventoryStatus === "missing";
  const resumoPreco = summarizePrices(pontosPreco);
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <CategoriaBolha category={produto.category} />
          <div>
            <p className="font-bold leading-tight">{produto.name}</p>
            <p className="text-xs text-ink-faint">
              {produto.brand ? `${produto.brand} · ` : ""}
              {produto.category} · comprado {produto.purchaseCount}x
            </p>
            {resumoPreco && (
              <button
                onClick={onVerPrecos}
                aria-label={`Ver evolução de preço de ${produto.name}`}
                className="mt-1 flex min-h-11 items-center gap-1 text-xs font-semibold text-ink-soft transition hover:text-primary-strong"
              >
                {formatCentsBRL(resumoPreco.lastCents)}
                {resumoPreco.trend === "up" && <TrendingUp size={13} className="text-danger" />}
                {resumoPreco.trend === "down" && (
                  <TrendingDown size={13} className="text-primary-strong" />
                )}
                <span className="font-normal text-ink-faint underline decoration-dotted underline-offset-2">
                  ver evolução
                </span>
              </button>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${
              emFalta ? "bg-coral-soft text-danger" : "bg-primary-soft text-primary-strong"
            }`}
          >
            {emFalta ? "Em falta" : "Em estoque"}
          </span>
          {produto.occasional && (
            <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-bold text-ink-faint">Eventual</span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Stepper productName={produto.name} value={produto.inventoryQuantity} pending={pending} onStep={onStock} />

        <IconButton label={`Adicionar ${produto.name} à lista`} pending={pending} onClick={onAddLista} variant="primary">
          <ShoppingCart size={15} strokeWidth={2.4} />
        </IconButton>
        <IconButton label={`Consumir ${produto.name}`} pending={pending || emFalta} onClick={onConsumir}>
          <Utensils size={15} strokeWidth={2.2} />
        </IconButton>
        <IconButton label={`Marcar ${produto.name} em falta`} pending={pending || emFalta} onClick={onFalta}>
          <PackageX size={15} strokeWidth={2.2} />
        </IconButton>
        <div className="ml-auto flex gap-2">
          <IconButton label={`Editar ${produto.name}`} pending={pending} onClick={onEditar}>
            <Pencil size={15} strokeWidth={2.2} />
          </IconButton>
          <IconButton label={`Excluir ${produto.name}`} pending={pending} onClick={onExcluir} variant="danger">
            <Trash2 size={15} strokeWidth={2.2} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function ArchivedCard({
  produto,
  pending,
  onDesarquivar,
}: {
  produto: ProductDTO;
  pending: boolean;
  onDesarquivar: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface/60 p-4">
      <div className="flex items-center gap-3">
        <CategoriaBolha category={produto.category} />
        <div>
          <p className="font-bold leading-tight text-ink-soft">{produto.name}</p>
          <p className="text-xs text-ink-faint">
            {produto.brand ? `${produto.brand} · ` : ""}
            {produto.category} · comprado {produto.purchaseCount}x · arquivado
          </p>
        </div>
      </div>
      <button
        disabled={pending}
        onClick={onDesarquivar}
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-soft transition hover:border-primary hover:text-primary-strong disabled:opacity-40"
      >
        <ArchiveRestore size={15} strokeWidth={2.2} />
        Desarquivar
      </button>
    </div>
  );
}

// Evolução de preço do produto: ajuda a decidir se vale comprar agora.
function PrecoModal({
  produto,
  pontos,
  onFechar,
}: {
  produto: ProductDTO;
  pontos: PricePoint[];
  onFechar: () => void;
}) {
  const { dialogRef, onKeyDown } = useAccessibleDialog(onFechar);
  // Ordem cronológica para o gráfico (o servidor manda mais recentes primeiro).
  const ordenados = useMemo(
    () => [...pontos].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)),
    [pontos]
  );
  const resumo = summarizePrices(pontos);
  const primeiro = ordenados[0];
  const ultimo = ordenados[ordenados.length - 1];
  const variacaoPeriodo =
    primeiro && ultimo && primeiro.priceCents > 0
      ? ((ultimo.priceCents - primeiro.priceCents) / primeiro.priceCents) * 100
      : null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink/30 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onFechar();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-dialog-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-card bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="price-dialog-title" className="text-lg font-black">Evolução de preço</h2>
            <p className="text-sm text-ink-faint">{produto.name}</p>
          </div>
          <button
            onClick={onFechar}
            aria-label="Fechar evolução de preço"
            data-dialog-initial-focus
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-line text-ink-soft transition hover:bg-bg"
          >
            <X size={16} />
          </button>
        </div>

        {ordenados.length < 2 ? (
          <p className="mt-4 rounded-xl bg-bg px-4 py-3 text-sm text-ink-soft">
            {ordenados.length === 0
              ? "Nenhum preço registrado ainda. Registre preços pelo app na hora da compra."
              : `Só um preço registrado (${formatCentsBRL(ordenados[0].priceCents)} em ${formatarData(ordenados[0].recordedAt)}). O gráfico aparece a partir do segundo registro.`}
          </p>
        ) : (
          <>
            <GraficoPreco pontos={ordenados} />
            <div className="mt-1 flex justify-between text-xs text-ink-faint">
              <span>{formatarData(primeiro.recordedAt)}</span>
              <span>{formatarData(ultimo.recordedAt)}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <ResumoItem rotulo="Último preço" valor={formatCentsBRL(ultimo.priceCents)} />
              <ResumoItem
                rotulo="No período"
                valor={
                  variacaoPeriodo === null
                    ? "—"
                    : `${variacaoPeriodo > 0 ? "+" : ""}${variacaoPeriodo.toFixed(1).replace(".", ",")}%`
                }
                destaque={variacaoPeriodo === null ? undefined : variacaoPeriodo > 0 ? "alta" : variacaoPeriodo < 0 ? "queda" : undefined}
              />
              {resumo && (
                <>
                  <ResumoItem rotulo="Menor registrado" valor={formatCentsBRL(resumo.minCents)} />
                  <ResumoItem rotulo="Maior registrado" valor={formatCentsBRL(resumo.maxCents)} />
                </>
              )}
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              {ordenados.length} registros · preços anotados pelo app na hora da compra.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ResumoItem({
  rotulo,
  valor,
  destaque,
}: {
  rotulo: string;
  valor: string;
  destaque?: "alta" | "queda";
}) {
  return (
    <div className="rounded-xl bg-bg px-3 py-2">
      <p className="text-xs text-ink-faint">{rotulo}</p>
      <p
        className={`font-bold ${
          destaque === "alta" ? "text-danger" : destaque === "queda" ? "text-primary-strong" : ""
        }`}
      >
        {valor}
      </p>
    </div>
  );
}

// Gráfico de linha simples em SVG (sem dependência): X = ordem dos registros,
// Y = preço. Pontos marcados; linhas-guia no menor e maior preço.
function GraficoPreco({ pontos }: { pontos: PricePoint[] }) {
  const w = 320;
  const h = 150;
  const padX = 10;
  const padY = 16;
  const valores = pontos.map((p) => p.priceCents);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const faixa = max - min || 1;
  const x = (i: number) => padX + (i * (w - 2 * padX)) / (pontos.length - 1);
  const y = (cents: number) => padY + ((max - cents) * (h - 2 * padY)) / faixa;
  const linha = pontos.map((p, i) => `${x(i)},${y(p.priceCents)}`).join(" ");

  return (
    <div className="mt-4">
      <div className="flex justify-between text-xs font-semibold text-ink-faint">
        <span>{formatCentsBRL(max)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Gráfico de preços">
        <line x1={padX} y1={y(max)} x2={w - padX} y2={y(max)} className="stroke-line" strokeDasharray="4 4" />
        <line x1={padX} y1={y(min)} x2={w - padX} y2={y(min)} className="stroke-line" strokeDasharray="4 4" />
        <polyline
          points={linha}
          fill="none"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-primary"
        />
        {pontos.map((p, i) => (
          <circle key={`${p.recordedAt}-${i}`} cx={x(i)} cy={y(p.priceCents)} r={3.5} className="fill-primary" />
        ))}
      </svg>
      <div className="flex justify-between text-xs font-semibold text-ink-faint">
        <span>{formatCentsBRL(min)}</span>
      </div>
    </div>
  );
}

function formatarData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}

function Stepper({
  productName,
  value,
  pending,
  onStep,
}: {
  productName: string;
  value: string;
  pending: boolean;
  onStep: (dir: 1 | -1) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-line p-1" role="group" aria-label={`Estoque de ${productName}`}>
      <button
        disabled={pending}
        onClick={() => onStep(-1)}
        className="flex h-11 w-11 items-center justify-center rounded-md text-ink-soft transition hover:bg-bg disabled:opacity-40"
        aria-label={`Diminuir estoque de ${productName}`}
      >
        <Minus size={16} />
      </button>
      <span className="min-w-16 text-center text-sm font-semibold tabular-nums" aria-live="polite" aria-atomic="true">{value}</span>
      <button
        disabled={pending}
        onClick={() => onStep(1)}
        className="flex h-11 w-11 items-center justify-center rounded-md text-ink-soft transition hover:bg-bg disabled:opacity-40"
        aria-label={`Aumentar estoque de ${productName}`}
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
      className={`flex h-11 w-11 items-center justify-center rounded-lg transition disabled:opacity-40 ${estilos}`}
    >
      {children}
    </button>
  );
}

function ProdutoModal({
  produto,
  erro,
  pending,
  onFechar,
  onSalvar,
}: {
  produto: ProductDTO | null;
  erro: string | null;
  pending: boolean;
  onFechar: () => void;
  onSalvar: (input: NewProductInput) => void;
}) {
  const { dialogRef, onKeyDown } = useAccessibleDialog(onFechar);
  const [name, setName] = useState(produto?.name ?? "");
  const [category, setCategory] = useState(produto?.category ?? CATEGORIAS[0]);
  const [brand, setBrand] = useState(produto?.brand ?? "");
  const [alertThreshold, setAlertThreshold] = useState(produto?.alertThreshold ?? "");
  const [occasional, setOccasional] = useState(produto?.occasional ?? false);

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink/30 p-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onFechar();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-dialog-title"
        aria-describedby={erro ? "product-dialog-error" : undefined}
        aria-busy={pending}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-card bg-surface p-5 shadow-xl"
      >
        <h2 id="product-dialog-title" className="text-lg font-black">{produto ? "Editar produto" : "Novo produto"}</h2>
        {erro && (
          <div id="product-dialog-error" role="alert" className="mt-3 flex items-center gap-2 rounded-xl bg-coral-soft px-4 py-3 text-sm font-medium text-danger">
            <AlertCircle size={16} />
            {erro}
          </div>
        )}
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-semibold text-ink-soft">Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              data-dialog-initial-focus
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
            <span className="text-sm font-semibold text-ink-soft">Marca (opcional)</span>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="ex.: Urbano"
              className="mt-1 w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none transition focus:border-primary"
            />
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
          <label className="flex items-start gap-3 rounded-xl border border-line p-3">
            <input
              type="checkbox"
              checked={occasional}
              onChange={(e) => setOccasional(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="text-sm font-semibold text-ink-soft">Compra eventual</span>
              <span className="block text-xs text-ink-faint">
                Itens de ocasião (ex.: churrasco) não geram alerta de reposição nem sugestão de recompra.
              </span>
            </span>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onFechar}
            className="min-h-11 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-bg"
          >
            Cancelar
          </button>
          <button
            disabled={pending}
            onClick={() =>
              onSalvar({
                name,
                category,
                brand: brand.trim() || null,
                alertThreshold,
                occasional,
                barcode: produto?.barcode ?? null,
                photoUri: produto?.photoUri ?? null,
              })
            }
            className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
