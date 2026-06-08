import "server-only";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth/options";
import { obterCredentialVersion } from "@/server/modules/casa";

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
  // Sessão antiga deixa de valer quando o código é regenerado: o JWT carrega a
  // versão de quando logou; se o banco avançou, encerra a sessão. (auditoria #13)
  const atual = await obterCredentialVersion(casaId);
  if (atual === null || atual !== (session?.credentialVersion ?? 0)) {
    redirect("/login");
  }
  return { casaId };
}
