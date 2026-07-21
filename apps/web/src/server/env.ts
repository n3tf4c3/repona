import "server-only";
import {
  parseAuthSecret,
  parseDatabaseUrl,
  parseInviteTokenSecret,
  parseLegacyTokenAcceptUntil,
  parseNextAuthOrigin,
  parseRateLimitPepper,
} from "../../env-schema.mjs";

// Adaptador server-only para o contrato puro de env. As regras vivem em
// env-schema.mjs e são as mesmas usadas pelo middleware Edge, Drizzle, CLIs e
// pelo comando env:check. A leitura continua preguiçosa para o build do Next não
// exigir credenciais durante a análise estática; o deploy valida o conjunto
// completo explicitamente com `npm run env:check`. (auditoria #89)

let cachedDatabaseUrl: string | undefined;
export function databaseUrl(): string {
  if (cachedDatabaseUrl === undefined) {
    cachedDatabaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
  }
  return cachedDatabaseUrl;
}

let cachedAuthSecret: string | undefined;
export function authSecret(): string {
  if (cachedAuthSecret === undefined) {
    cachedAuthSecret = parseAuthSecret({
      AUTH_SECRET: process.env.AUTH_SECRET,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    });
  }
  return cachedAuthSecret;
}

let cachedInviteTokenSecret: string | undefined;
export function inviteTokenSecret(): string {
  if (cachedInviteTokenSecret === undefined) {
    cachedInviteTokenSecret = parseInviteTokenSecret(process.env.INVITE_TOKEN_SECRET);
  }
  return cachedInviteTokenSecret;
}

let cachedNextAuthOrigin: string | undefined;
export function nextauthOrigin(): string {
  if (cachedNextAuthOrigin === undefined) {
    cachedNextAuthOrigin = parseNextAuthOrigin(
      process.env.NEXTAUTH_URL,
      process.env.NODE_ENV
    );
  }
  return cachedNextAuthOrigin;
}

// O pepper dedicado é opcional: ausente, rateLimitToken deriva material separado
// de INVITE_TOKEN_SECRET via HKDF. Se estiver definido, porém, precisa satisfazer
// o mesmo mínimo de 32 caracteres; valor curto não é mais ignorado em silêncio.
let cachedRateLimitPepper: string | null | undefined;
export function rateLimitPepper(): string | null {
  if (cachedRateLimitPepper === undefined) {
    cachedRateLimitPepper = parseRateLimitPepper(process.env.RATE_LIMIT_PEPPER);
  }
  return cachedRateLimitPepper;
}

let cachedLegacyTokenAcceptUntil: string | undefined;
export function legacyTokenAcceptUntil(): string {
  if (cachedLegacyTokenAcceptUntil === undefined) {
    cachedLegacyTokenAcceptUntil = parseLegacyTokenAcceptUntil(
      process.env.LEGACY_TOKEN_ACCEPT_UNTIL
    );
  }
  return cachedLegacyTokenAcceptUntil;
}
