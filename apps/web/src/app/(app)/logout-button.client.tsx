"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-line2"
    >
      <LogOut size={15} strokeWidth={2.2} />
      <span className="hidden sm:inline">Sair</span>
    </button>
  );
}
