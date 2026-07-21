import "server-only";
import { headers } from "next/headers";
import { autorizadoAdmin } from "./adminAuth";

// Revalida a autorização de admin de dentro de uma Server Action, lendo o header
// Authorization que o navegador reenvia a cada request de /admin (inclusive o
// POST da Action). É defesa em profundidade: o proxy já protege o perímetro,
// mas uma falha futura de matcher/roteamento não deve deixar uma Action
// destrutiva executar sem decisão de autorização própria. (auditoria #70)
export async function requireAdmin(): Promise<void> {
  const h = await headers();
  if (!autorizadoAdmin(h.get("authorization"))) {
    throw new Error("ADMIN_UNAUTHORIZED");
  }
}
