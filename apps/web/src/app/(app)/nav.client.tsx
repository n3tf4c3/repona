"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Package, ListChecks, History, User, type LucideIcon } from "lucide-react";

const links: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/inicio", label: "Início", Icon: Home },
  { href: "/produtos", label: "Produtos", Icon: Package },
  { href: "/lista", label: "Lista", Icon: ListChecks },
  { href: "/historico", label: "Histórico", Icon: History },
  { href: "/perfil", label: "Perfil", Icon: User },
];

function ativoEm(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

// Navegação no topo (desktop/tablet).
export function NavTop() {
  const pathname = usePathname();
  return (
    <nav className="hidden gap-1 sm:flex">
      {links.map(({ href, label, Icon }) => {
        const ativo = ativoEm(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              ativo ? "bg-primary text-white" : "text-ink-soft hover:bg-line2"
            }`}
          >
            <Icon size={16} strokeWidth={2.4} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

// Barra de abas inferior (mobile).
export function NavBottom() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface/95 backdrop-blur sm:hidden">
      {links.map(({ href, label, Icon }) => {
        const ativo = ativoEm(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition ${
              ativo ? "text-primary-strong" : "text-ink-faint"
            }`}
          >
            <Icon size={20} strokeWidth={ativo ? 2.6 : 2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
