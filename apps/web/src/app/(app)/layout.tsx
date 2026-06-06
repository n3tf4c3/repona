import { requireUser } from "@/server/auth/session";
import { Nav } from "./nav.client";
import { LogoutButton } from "./logout-button.client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="min-h-screen bg-[#F6F5EF] text-[#212418]">
      <header className="sticky top-0 z-10 border-b border-[#E7E5D9] bg-[#F6F5EF]/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-lg font-black tracking-tight text-[#236B43]">Repona</span>
            <Nav />
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
