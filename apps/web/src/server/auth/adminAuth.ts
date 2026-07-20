// Verificação do HTTP Basic Auth do painel /admin contra ADMIN_SECRET.
//
// Puro e sem imports de framework (nada de next/headers, server-only ou db) para
// poder ser usado tanto pelo middleware (runtime Edge) quanto pelo requireAdmin
// das Server Actions (runtime Node). A decisão de autorização vive aqui, uma vez
// só, e é chamada nos dois pontos: o middleware é a primeira barreira e cada
// Action destrutiva revalida por dentro, sem depender só do perímetro de rota.
// (auditoria #70)

// Comparação de tempo constante: o comprimento pode curto-circuitar (revela só o
// tamanho da tentativa, não do segredo), o resto não vaza por timing.
function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// True só quando ADMIN_SECRET está configurado com tamanho mínimo. Sem isso o
// painel fica indisponível (503), nunca aberto.
export function adminSecretConfigurado(): boolean {
  const secret = process.env.ADMIN_SECRET;
  return Boolean(secret && secret.length >= 16);
}

// Valida o header Authorization: Basic <base64(user:pass)> contra ADMIN_SECRET.
export function autorizadoAdmin(authorizationHeader: string | null): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 16) return false;

  const [scheme, encoded] = (authorizationHeader ?? "").split(" ");
  if (scheme !== "Basic" || !encoded) return false;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }
  // Exige o separador user:pass; sem ele a credencial é malformada. (auditoria #61)
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  // Aceita qualquer usuário; a credencial é a senha (= ADMIN_SECRET).
  return constEq(decoded.slice(sep + 1), secret);
}
