import { Apple, Milk, Coffee, ShoppingBasket, SprayCan, Package, type LucideIcon } from "lucide-react";

type Visual = { Icon: LucideIcon; bg: string; fg: string };

const VISUAIS: Record<string, Visual> = {
  Hortifrúti: { Icon: Apple, bg: "bg-primary-soft", fg: "text-primary-strong" },
  Laticínios: { Icon: Milk, bg: "bg-amber-soft", fg: "text-amber-ink" },
  Bebidas: { Icon: Coffee, bg: "bg-coral-soft", fg: "text-coral" },
  Mercearia: { Icon: ShoppingBasket, bg: "bg-indigo-soft", fg: "text-indigo" },
  Limpeza: { Icon: SprayCan, bg: "bg-indigo-soft", fg: "text-indigo" },
};

const PADRAO: Visual = { Icon: Package, bg: "bg-primary-soft", fg: "text-primary-strong" };

export function CategoriaBolha({ category, size = 44 }: { category: string; size?: number }) {
  const { Icon, bg, fg } = VISUAIS[category] ?? PADRAO;
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-2xl ${bg}`}
      style={{ width: size, height: size }}
    >
      <Icon className={fg} size={Math.round(size * 0.5)} strokeWidth={2.2} />
    </span>
  );
}
