import "server-only";
import { z } from "zod";

// Ponto único de leitura/validação das variáveis de ambiente sensíveis do
// servidor (auditoria #89). Antes cada módulo lia process.env com regras próprias
// e dispersas; aqui a regra de cada segredo fica num só lugar, com mensagem
// consistente e sem valores no erro.
//
// Superfície completa de env crítica e onde é validada:
//   - DATABASE_URL        -> databaseUrl() (aqui)  | tooling: drizzle.config.ts
//   - AUTH_SECRET /
//     NEXTAUTH_SECRET     -> authSecret() (aqui)
//   - INVITE_TOKEN_SECRET -> inviteTokenSecret() (aqui)
//   - ADMIN_SECRET        -> server/auth/adminAuth.ts (precisa ser Edge-safe,
//                            usado pelo middleware; não pode importar este módulo
//                            server-only)
//
// A validação é PREGUIÇOSA e por campo: só dispara quando o consumidor lê aquele
// valor, para não exigir todas as variáveis durante o build/dev parcial nem
// falhar no import (o mesmo motivo pelo qual os módulos originais liam em
// runtime). Cada resultado é memoizado.

const secretSchema = z.string().min(16, "defina um segredo aleatório (>= 16 chars)");
const urlSchema = z.string().url();

function validar<T>(schema: z.ZodType<T>, valor: unknown, nome: string, dica: string): T {
  const r = schema.safeParse(valor);
  if (!r.success) throw new Error(`${nome} ausente ou inválido: ${dica}`);
  return r.data;
}

let _databaseUrl: string | undefined;
export function databaseUrl(): string {
  if (_databaseUrl === undefined) {
    _databaseUrl = validar(
      urlSchema,
      process.env.DATABASE_URL,
      "DATABASE_URL",
      "URL de conexão do Postgres (ex.: Neon)."
    );
  }
  return _databaseUrl;
}

let _authSecret: string | undefined;
export function authSecret(): string {
  if (_authSecret === undefined) {
    // AUTH_SECRET é o canônico; NEXTAUTH_SECRET é o alias aceito pela Vercel/
    // NextAuth (mesmo valor). Basta um estar presente e forte.
    _authSecret = validar(
      secretSchema,
      process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
      "AUTH_SECRET/NEXTAUTH_SECRET",
      "segredo do NextAuth para assinar a sessão (>= 16 chars)."
    );
  }
  return _authSecret;
}

let _inviteTokenSecret: string | undefined;
export function inviteTokenSecret(): string {
  if (_inviteTokenSecret === undefined) {
    _inviteTokenSecret = validar(
      secretSchema,
      process.env.INVITE_TOKEN_SECRET,
      "INVITE_TOKEN_SECRET",
      "segredo para cifrar o token da casa em repouso (>= 16 chars)."
    );
  }
  return _inviteTokenSecret;
}
