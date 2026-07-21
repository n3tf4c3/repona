import { NextRequest, NextResponse } from "next/server";
import { rateLimited, ipDaRequest } from "@/server/rateLimit";
import { adminSecretConfigurado, autorizadoAdmin } from "@/server/auth/adminAuth";

// O proxy faz duas coisas:
//   1. CSP completa com nonce por requisição em TODAS as rotas de documento
//      (auditoria #34) — enforcing.
//   2. Proteção do painel admin (/admin) por HTTP Basic Auth — só nesse prefixo.
//
// Roda em todas as rotas de documento, exceto assets estáticos do Next (que não
// são documentos HTML e não carregam CSP). A lógica de rate limit/DB do admin só
// dispara para /admin, então rotas comuns não ganham custo de banco.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

// --- CSP com nonce (auditoria #34) -----------------------------------------
// script-src usa nonce por requisição + 'strict-dynamic': o Next lê o nonce do
// header Content-Security-Policy da REQUISIÇÃO e o aplica automaticamente aos
// seus próprios scripts de bootstrap/hidratação. style-src mantém 'unsafe-inline'
// de propósito: estilos inline do React não recebem nonce de forma
// confiável, e injeção de estilo é risco muito menor que a de script. Sem
// recursos externos no app (imagens, fontes, fetch são todos same-origin), então
// default-src/img-src/font-src/connect-src ficam em 'self'.
function gerarNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function montarCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

// --- Proteção do painel admin (auditoria #48, #70) -------------------------
// Throttle do Basic Auth por IP: o painel pode excluir qualquer casa, então
// limitar tentativas contra o ADMIN_SECRET fecha brute force distribuído. Erro do
// limiter propaga (fail-closed). A verificação do Basic Auth vive em
// server/auth/adminAuth.ts (Edge-safe), compartilhada com o requireAdmin das
// Server Actions.
const ADMIN_JANELA_SEG = 60;
const ADMIN_MAX_POR_IP = 60;

// Devolve uma resposta de bloqueio (503/429/401) quando o acesso ao admin deve
// ser negado; null quando autorizado (segue para aplicar a CSP).
async function protegerAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (!adminSecretConfigurado()) {
    // Sem segredo configurado o painel fica indisponível, nunca aberto.
    return new NextResponse("Painel admin indisponível.", { status: 503 });
  }
  if (await rateLimited(`admin:ip:${ipDaRequest(req.headers)}`, ADMIN_MAX_POR_IP, ADMIN_JANELA_SEG)) {
    return new NextResponse("Muitas tentativas. Aguarde e tente novamente.", { status: 429 });
  }
  if (autorizadoAdmin(req.headers.get("authorization"))) {
    return null;
  }
  return new NextResponse("Autenticação necessária.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Repona Admin"' },
  });
}

export async function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/admin")) {
    const bloqueio = await protegerAdmin(req);
    if (bloqueio) return bloqueio;
  }

  const nonce = gerarNonce();
  const csp = montarCsp(nonce);

  // O header na REQUISIÇÃO é o que faz o Next aplicar o nonce aos seus scripts;
  // o header na RESPOSTA é o que o navegador enforça.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}
