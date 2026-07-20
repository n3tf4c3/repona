import { NextRequest, NextResponse } from "next/server";
import { rateLimited, ipDaRequest } from "@/server/rateLimit";
import { adminSecretConfigurado, autorizadoAdmin } from "@/server/auth/adminAuth";

// Proteção do painel admin (/admin) por HTTP Basic Auth contra ADMIN_SECRET.
// O web não tem papel de administrador — o login normal é só o token de uma
// casa (server/auth/options.ts). Em vez de introduzir um provider/role, o painel
// fica atrás de um segredo de ambiente: simples, sem dependência nova, e o
// próprio navegador guarda a credencial após o prompt nativo. As Server Actions
// da página postam para /admin, então também passam por aqui.
export const config = { matcher: ["/admin/:path*"] };

// A verificação do Basic Auth vive em server/auth/adminAuth.ts (Edge-safe),
// compartilhada com o requireAdmin das Server Actions. (auditoria #70)

// Throttle do Basic Auth (auditoria #48): diferente do login, sync e criação/
// exclusão de casa, o painel não limitava tentativas contra o ADMIN_SECRET,
// apesar de poder excluir qualquer casa. Limita por IP. Folgado o bastante para
// não atrapalhar o admin legítimo (que pode apagar várias casas em sequência),
// mas fecha o brute force distribuído. Erro do limiter propaga (fail-closed),
// como nas demais rotas.
const ADMIN_JANELA_SEG = 60;
const ADMIN_MAX_POR_IP = 60;

export async function middleware(req: NextRequest) {
  if (!adminSecretConfigurado()) {
    // Sem segredo configurado o painel fica indisponível, nunca aberto.
    return new NextResponse("Painel admin indisponível.", { status: 503 });
  }
  if (await rateLimited(`admin:ip:${ipDaRequest(req.headers)}`, ADMIN_MAX_POR_IP, ADMIN_JANELA_SEG)) {
    return new NextResponse("Muitas tentativas. Aguarde e tente novamente.", { status: 429 });
  }
  if (autorizadoAdmin(req.headers.get("authorization"))) {
    return NextResponse.next();
  }
  return new NextResponse("Autenticação necessária.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Repona Admin"' },
  });
}
