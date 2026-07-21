import "server-only";
import { createHmac, hkdfSync } from "crypto";
import { inviteTokenSecret, rateLimitPepper } from "@/server/env";

// Fingerprint do token para usar como chave de rate limit, em vez de gravar o
// token (a única credencial da casa) em claro em rate_limits.chave. Antes as
// chaves login:token:/sync:token:/casa-del:token: interpolavam o token literal,
// então um dump ou leitura somente-leitura do banco revelaria tokens ativos —
// contornando a cifragem de casas.invite_code_enc. (auditoria #43)
//
// HMAC-SHA-256 com pepper dedicado e separação por contexto. Mesmo com o token
// em ~60 bits (auditoria #71), um hash simples seria reversível por força bruta a
// partir do banco; o segredo do HMAC impede isso sem conhecer o pepper.

// Pepper dedicado. Usa RATE_LIMIT_PEPPER se definido; senão deriva de
// INVITE_TOKEN_SECRET com contexto próprio (HKDF) — assim não exige uma variável
// de ambiente nova para o deploy não quebrar, mantendo material de chave separado
// por propósito. Memoizado.
let _pepper: Buffer | undefined;
function pepper(): Buffer {
  if (_pepper === undefined) {
    const dedicado = rateLimitPepper();
    if (dedicado) {
      _pepper = Buffer.from(dedicado, "utf8");
    } else {
      _pepper = Buffer.from(
        hkdfSync(
          "sha256",
          Buffer.from(inviteTokenSecret(), "utf8"),
          Buffer.alloc(0),
          "repona-rate-limit-pepper-v1",
          32
        )
      );
    }
  }
  return _pepper;
}

// Devolve o fingerprint base64url do token no contexto dado (login/sync/casa-del).
export function fingerprintToken(token: string, contexto: string): string {
  return createHmac("sha256", pepper())
    .update(`repona:${contexto}:v1:${token}`)
    .digest("base64url");
}
