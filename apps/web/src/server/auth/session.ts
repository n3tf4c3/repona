import "server-only";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth/options";
import { garantirCasa } from "@/server/modules/casa";

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
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    redirect("/login");
  }
  return { id: userId };
}

// Garante usuário autenticado e resolve a casa dele (criando se necessário).
// Os dados de domínio são escopados por casa.
export async function requireCasa(): Promise<{ userId: number; casaId: number }> {
  const { id } = await requireUser();
  const casaId = await garantirCasa(id);
  return { userId: id, casaId };
}
