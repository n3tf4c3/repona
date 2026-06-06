"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/produtos", label: "Produtos" },
  { href: "/lista", label: "Lista" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1">
      {links.map((link) => {
        const ativo = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              ativo
                ? "bg-[#2E8B57] text-white"
                : "text-foreground/60 hover:bg-foreground/5"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
