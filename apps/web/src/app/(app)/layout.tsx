import { ShoppingBasket } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { NavTop, NavBottom } from "./nav.client";
import { LogoutButton } from "./logout-button.client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 text-lg font-black tracking-tight text-primary-strong">
              <ShoppingBasket size={22} strokeWidth={2.4} />
              Repona
            </span>
            <NavTop />
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 pb-24 sm:pb-6">{children}</main>
      <NavBottom />
    </div>
  );
}
