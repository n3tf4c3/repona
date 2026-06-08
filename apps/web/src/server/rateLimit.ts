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
