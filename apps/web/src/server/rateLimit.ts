import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { rateLimits, syncLocks } from "@/server/db/schema";

// Rate limit (auditoria #12) e lock de sync (auditoria #1/#21) sobre o próprio
// Postgres (Neon). Antes dependiam de Vercel KV; agora o estado mora no banco
// que o projeto já usa — global entre instâncias serverless, sem serviço pago
// e sem fallback em memória que abria brecha de brute force/corrida (#44).

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
  const novoReset = new Date(Date.now() + janelaSeg * 1000);
  // Upsert atômico num único statement: em janela nova ou expirada o contador
  // volta a 1; senão incrementa. Sendo uma só instrução, é seguro entre
  // instâncias concorrentes.
  const [r] = await db
    .insert(rateLimits)
    .values({ chave, count: 1, resetEm: novoReset })
    .onConflictDoUpdate({
      target: rateLimits.chave,
      set: {
        count: sql`case when ${rateLimits.resetEm} <= now() then 1 else ${rateLimits.count} + 1 end`,
        resetEm: sql`case when ${rateLimits.resetEm} <= now() then ${novoReset} else ${rateLimits.resetEm} end`,
      },
    })
    .returning({ count: rateLimits.count });
  // Poda oportunística (auditoria #49): as chaves incluem IP e token, de
  // cardinalidade não-limitada, então sem limpeza a tabela cresceria sem teto.
  // Com baixa probabilidade, apaga contadores expirados há mais de uma hora —
  // sem cron/infra externa. Uma linha removida por engano é reinserida pelo
  // próximo hit (o upsert recria com count=1), então é seguro.
  if (Math.random() < 0.02) {
    await db.delete(rateLimits).where(lt(rateLimits.resetEm, new Date(Date.now() - 60 * 60 * 1000)));
  }
  return (r?.count ?? 1) > max;
}

export async function tryLock(chave: string, ttlSeg: number): Promise<string | null> {
  // crypto global (Web Crypto), disponível no Node 20+ e no Edge runtime — sem
  // import de `node:crypto`, para este módulo poder ser usado também no
  // proxy do Next que aplica rate limit no /admin. (auditoria #48)
  const token = crypto.randomUUID();
  const expiraEm = new Date(Date.now() + ttlSeg * 1000);
  // Adquire só se não há lock vivo: insere e, em conflito, sobrescreve apenas se
  // o lock atual já expirou (setWhere). O RETURNING devolve linha quando de fato
  // adquirimos (insert novo ou takeover de lock expirado) e vem vazio quando
  // alguém ainda detém — tudo atômico no banco.
  const [r] = await db
    .insert(syncLocks)
    .values({ chave, token, expiraEm })
    .onConflictDoUpdate({
      target: syncLocks.chave,
      set: { token, expiraEm },
      setWhere: sql`${syncLocks.expiraEm} <= now()`,
    })
    .returning({ token: syncLocks.token });
  return r ? token : null;
}

export async function renewLock(chave: string, token: string, ttlSeg: number): Promise<boolean> {
  const [renewed] = await db
    .update(syncLocks)
    .set({ expiraEm: new Date(Date.now() + ttlSeg * 1000) })
    .where(
      and(
        eq(syncLocks.chave, chave),
        eq(syncLocks.token, token),
        // Uma lease já expirada não pode ser ressuscitada: outro worker pode ter
        // observado a expiração e estar prestes a assumir. O token também evita
        // renovar a lease do sucessor. (#74)
        sql`${syncLocks.expiraEm} > now()`
      )
    )
    .returning({ token: syncLocks.token });
  return renewed?.token === token;
}

export async function unlock(chave: string, token: string): Promise<void> {
  // Compare-and-delete: só libera se ainda somos o dono (auditoria #21).
  await db.delete(syncLocks).where(and(eq(syncLocks.chave, chave), eq(syncLocks.token, token)));
}
