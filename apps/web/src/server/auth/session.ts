import "server-only";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth/options";

export async function getAuthSession() {
  return getServerSession(authOptions);
}

// Garante uma sessão válida e devolve o casaId. A conta = a casa, então o
// session.user.id guarda o casaId. Os dados de domínio são escopados por casa.
export async function requireCasa(): Promise<{ casaId: number }> {
  const session = await getAuthSession();
  const casaId = Number(session?.user?.id);
  if (!Number.isInteger(casaId) || casaId <= 0) {
    redirect("/login");
  }
  return { casaId };
}
