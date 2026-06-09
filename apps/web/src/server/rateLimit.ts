import "server-only";
import { kv } from "@vercel/kv";

// Rate limit por chave (auditoria #12). Quando o Vercel KV está configurado
// (KV_REST_API_URL/KV_REST_API_TOKEN), o contador é global e persistente, então
// vale entre instâncias serverless. Sem KV (dev/local), cai para um contador em
// memória — que NÃO é global, mas mantém o endpoint utilizável fora da Vercel.
const kvConfigurado = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

const memoria = new Map<string, { count: number; resetAt: number }>();

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

// Lock simples por chave com TTL (auditoria 2026-06-09 #1). Usado para
// serializar o merge de sync por casa: o merge faz dezenas de escritas sem
// transação (driver neon-http), e dois devices da mesma casa mesclando ao mesmo
// tempo podem inserir o mesmo produto e estourar os índices únicos no meio do
// caminho. O TTL garante que um merge que morreu não tranca a casa para sempre.
// Mesmo trade-off do rate limit: com KV o lock é global; sem KV (dev/local) é
// por instância.
const locksMemoria = new Map<string, number>();

export async function tryLock(chave: string, ttlSeg: number): Promise<boolean> {
  if (kvConfigurado) {
    const ok = await kv.set(chave, "1", { nx: true, ex: ttlSeg });
    return ok === "OK";
  }
  const agora = Date.now();
  const expiraEm = locksMemoria.get(chave);
  if (expiraEm !== undefined && expiraEm > agora) return false;
  locksMemoria.set(chave, agora + ttlSeg * 1000);
  return true;
}

export async function unlock(chave: string): Promise<void> {
  if (kvConfigurado) {
    await kv.del(chave);
    return;
  }
  locksMemoria.delete(chave);
}
