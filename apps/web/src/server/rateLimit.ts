import "server-only";
import { randomUUID } from "crypto";
import { kv } from "@vercel/kv";

// Rate limit por chave (auditoria #12). Quando o Vercel KV está configurado
// (KV_REST_API_URL/KV_REST_API_TOKEN), o contador é global e persistente, então
// vale entre instâncias serverless. Sem KV (dev/local), cai para um contador em
// memória — que NÃO é global, mas mantém o endpoint utilizável fora da Vercel.
const kvConfigurado = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

const memoria = new Map<string, { count: number; resetAt: number }>();

// IP confiável da requisição para a chave de rate limit (auditoria #32). Na
// Vercel, `x-real-ip` é o IP real do cliente definido pela plataforma. Já o
// primeiro valor de `x-forwarded-for` é enviado pelo cliente e pode ser forjado
// para variar a chave e furar o limite — então preferimos `x-real-ip` e, no
// fallback, usamos o último valor do XFF (o mais próximo do servidor) em vez do
// primeiro.
export function ipDaRequest(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const partes =
    headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((p) => p.trim())
      .filter(Boolean) ?? [];
  return partes[partes.length - 1] || "desconhecido";
}

export async function rateLimited(
  chave: string,
  max: number,
  janelaSeg: number
): Promise<boolean> {
  if (kvConfigurado) {
    const atual = await kv.incr(chave);
    // Primeira ocorrência na janela: define a expiração do contador.
    if (atual === 1) await kv.expire(chave, janelaSeg);
    return atual > max;
  }

  const agora = Date.now();
  const t = memoria.get(chave);
  if (!t || t.resetAt <= agora) {
    memoria.set(chave, { count: 1, resetAt: agora + janelaSeg * 1000 });
    return false;
  }
  t.count += 1;
  return t.count > max;
}

// Lock por chave com TTL e DONO (auditoria 2026-06-09 #1, #21). Usado para
// serializar o merge de sync por casa: o merge faz dezenas de escritas sem
// transação (driver neon-http), e dois devices da mesma casa mesclando ao mesmo
// tempo podem inserir o mesmo produto e estourar os índices únicos no meio do
// caminho. O TTL garante que um merge que morreu não tranca a casa para sempre.
// tryLock devolve um token único quando adquire (ou null); unlock só libera se o
// token ainda é o dono — assim um merge que estourou o TTL e foi sucedido por
// outro não apaga o lock alheio ao terminar (auditoria #21). Mesmo trade-off do
// rate limit: com KV o lock é global; sem KV (dev/local) é por instância.
const locksMemoria = new Map<string, { token: string; expiraEm: number }>();

// Compare-and-delete atômico no KV: só apaga se o valor ainda for o do dono.
const LIBERAR_SE_DONO =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export async function tryLock(chave: string, ttlSeg: number): Promise<string | null> {
  const token = randomUUID();
  if (kvConfigurado) {
    const ok = await kv.set(chave, token, { nx: true, ex: ttlSeg });
    return ok === "OK" ? token : null;
  }
  const agora = Date.now();
  const atual = locksMemoria.get(chave);
  if (atual !== undefined && atual.expiraEm > agora) return null;
  locksMemoria.set(chave, { token, expiraEm: agora + ttlSeg * 1000 });
  return token;
}

export async function unlock(chave: string, token: string): Promise<void> {
  if (kvConfigurado) {
    await kv.eval(LIBERAR_SE_DONO, [chave], [token]);
    return;
  }
  const atual = locksMemoria.get(chave);
  if (atual?.token === token) locksMemoria.delete(chave);
}
