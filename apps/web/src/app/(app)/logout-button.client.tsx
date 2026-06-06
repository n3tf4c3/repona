"use client";

import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="rounded-lg border border-foreground/15 px-3 py-1.5 text-sm font-medium text-foreground/70 transition hover:bg-foreground/5"
    >
      Sair
    </button>
  );
}
