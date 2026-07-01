import { NextRequest, NextResponse } from "next/server";
import { rateLimited, ipDaRequest } from "@/server/rateLimit";

// Proteção do painel admin (/admin) por HTTP Basic Auth contra ADMIN_SECRET.
// O web não tem papel de administrador — o login normal é só o token de uma
// casa (server/auth/options.ts). Em vez de introduzir um provider/role, o painel
// fica atrás de um segredo de ambiente: simples, sem dependência nova, e o
// próprio navegador guarda a credencial após o prompt nativo. As Server Actions
// da página postam para /admin, então também passam por aqui.
export const config = { matcher: ["/admin/:path*"] };

// Comparação de tempo constante para a senha, evitando vazar o segredo por
// timing. O comprimento pode diferir (curto-circuita), o que só revela o tamanho
// da tentativa — não do segredo.
function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function autorizado(header: string | null, secret: string): boolean {
  const [scheme, encoded] = (header ?? "").split(" ");
  if (scheme !== "Basic" || !encoded) return false;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }
  // Aceita qualquer usuário; a credencial é a senha (= ADMIN_SECRET).
  const senha = decoded.slice(decoded.indexOf(":") + 1);
  return constEq(senha, secret);
}

// Throttle do Basic Auth (auditoria #48): diferente do login, sync e criação/
// exclusão de casa, o painel não limitava tentativas contra o ADMIN_SECRET,
// apesar de poder excluir qualquer casa. Limita por IP. Folgado o bastante para
// não atrapalhar o admin legítimo (que pode apagar várias casas em sequência),
// mas fecha o brute force distribuído. Erro do limiter propaga (fail-closed),
// como nas demais rotas.
const ADMIN_JANELA_SEG = 60;
const ADMIN_MAX_POR_IP = 60;

export async function middleware(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 16) {
    // Sem segredo configurado o painel fica indisponível, nunca aberto.
    return new NextResponse("Painel admin indisponível.", { status: 503 });
  }
  if (await rateLimited(`admin:ip:${ipDaRequest(req.headers)}`, ADMIN_MAX_POR_IP, ADMIN_JANELA_SEG)) {
    return new NextResponse("Muitas tentativas. Aguarde e tente novamente.", { status: 429 });
  }
  if (autorizado(req.headers.get("authorization"), secret)) {
    return NextResponse.next();
  }
  return new NextResponse("Autenticação necessária.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Repona Admin"' },
  });
}
