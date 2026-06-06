import "server-only";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth/options";

export async function getAuthSession() {
  return getServerSession(authOptions);
}

// Garante usuário autenticado. Redireciona para /login se não houver sessão.
// Retorna o id numérico do usuário (o JWT guarda como string).
export async function requireUser(): Promise<{ id: number }> {
  const session = await getAuthSession();
  const id = session?.user?.id;
  if (!id) {
    redirect("/login");
  }
  return { id: Number(id) };
}
