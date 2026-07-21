import { z } from "zod";

// Contrato puro e compartilhado entre o runtime Next.js, o middleware Edge,
// Drizzle e os CLIs. Este módulo não lê process.env e não importa APIs de Node,
// portanto cada consumidor fornece explicitamente o ambiente que quer validar.
// (auditoria #89)
export const MIN_SECRET_LENGTH = 32;
export const DEFAULT_LEGACY_TOKEN_ACCEPT_UNTIL = "2027-01-01T00:00:00.000Z";
export const LEGACY_TOKEN_MIGRATION_HARD_END = "2027-04-01T00:00:00.000Z";

const emptyToUndefined = (value) => (value === "" ? undefined : value);

const requiredSecretSchema = z
  .string()
  .min(MIN_SECRET_LENGTH, `deve ter pelo menos ${MIN_SECRET_LENGTH} caracteres`)
  .refine((value) => value.trim().length > 0, "não pode conter apenas espaços");

const optionalSecretSchema = z.preprocess(
  emptyToUndefined,
  requiredSecretSchema.optional()
);

const legacyTokenAcceptUntilSchema = z
  .preprocess(
    emptyToUndefined,
    z.string().datetime({ offset: true }).default(DEFAULT_LEGACY_TOKEN_ACCEPT_UNTIL)
  )
  .refine(
    (value) => Date.parse(value) <= Date.parse(LEGACY_TOKEN_MIGRATION_HARD_END),
    `não pode ultrapassar o hard end ${LEGACY_TOKEN_MIGRATION_HARD_END}`
  );

const databaseUrlSchema = z
  .string()
  .min(1, "é obrigatória")
  .url("deve ser uma URL válida")
  .superRefine((value, context) => {
    try {
      const protocol = new URL(value).protocol;
      if (protocol !== "postgres:" && protocol !== "postgresql:") {
        context.addIssue({
          code: "custom",
          message: "deve usar o protocolo postgres:// ou postgresql://",
        });
      }
    } catch {
      // O validador de URL acima já produz o erro apropriado.
    }
  });

const nextAuthUrlSchema = z
  .string()
  .min(1, "é obrigatória")
  .url("deve ser uma URL válida")
  .superRefine((value, context) => {
    try {
      const protocol = new URL(value).protocol;
      if (protocol !== "http:" && protocol !== "https:") {
        context.addIssue({
          code: "custom",
          message: "deve usar o protocolo http:// ou https://",
        });
      }
    } catch {
      // O validador de URL acima já produz o erro apropriado.
    }
  });

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");

function addAuthAliasIssues(value, context) {
  if (!value.AUTH_SECRET && !value.NEXTAUTH_SECRET) {
    context.addIssue({
      code: "custom",
      path: ["AUTH_SECRET"],
      message: "defina AUTH_SECRET ou NEXTAUTH_SECRET",
    });
    return;
  }

  if (
    value.AUTH_SECRET &&
    value.NEXTAUTH_SECRET &&
    value.AUTH_SECRET !== value.NEXTAUTH_SECRET
  ) {
    context.addIssue({
      code: "custom",
      path: ["NEXTAUTH_SECRET"],
      message: "deve ser idêntico a AUTH_SECRET quando ambos estiverem definidos",
    });
  }
}

function addProductionUrlIssues(value, context) {
  if (value.NODE_ENV !== "production") return;

  try {
    if (new URL(value.NEXTAUTH_URL).protocol !== "https:") {
      context.addIssue({
        code: "custom",
        path: ["NEXTAUTH_URL"],
        message: "deve usar https:// em produção",
      });
    }
  } catch {
    // O schema do campo já informa URL malformada.
  }
}

const authAliasesSchema = z
  .object({
    AUTH_SECRET: optionalSecretSchema,
    NEXTAUTH_SECRET: optionalSecretSchema,
  })
  .superRefine(addAuthAliasIssues)
  .transform((value) => value.AUTH_SECRET ?? value.NEXTAUTH_SECRET);

const nextAuthEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    NEXTAUTH_URL: nextAuthUrlSchema,
  })
  .superRefine(addProductionUrlIssues);

export const criticalEnvironmentSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    DATABASE_URL: databaseUrlSchema,
    AUTH_SECRET: optionalSecretSchema,
    NEXTAUTH_SECRET: optionalSecretSchema,
    INVITE_TOKEN_SECRET: requiredSecretSchema,
    ADMIN_SECRET: requiredSecretSchema,
    NEXTAUTH_URL: nextAuthUrlSchema,
    RATE_LIMIT_PEPPER: optionalSecretSchema,
    LEGACY_TOKEN_ACCEPT_UNTIL: legacyTokenAcceptUntilSchema,
  })
  .superRefine((value, context) => {
    addAuthAliasIssues(value, context);
    addProductionUrlIssues(value, context);
  })
  .transform((value) => ({
    nodeEnv: value.NODE_ENV,
    databaseUrl: value.DATABASE_URL,
    authSecret: value.AUTH_SECRET ?? value.NEXTAUTH_SECRET,
    inviteTokenSecret: value.INVITE_TOKEN_SECRET,
    adminSecret: value.ADMIN_SECRET,
    nextAuthUrl: value.NEXTAUTH_URL,
    nextAuthOrigin: new URL(value.NEXTAUTH_URL).origin,
    rateLimitPepper: value.RATE_LIMIT_PEPPER ?? null,
    legacyTokenAcceptUntil: value.LEGACY_TOKEN_ACCEPT_UNTIL,
  }));

export class EnvironmentValidationError extends Error {
  constructor(issues) {
    const normalizedIssues = issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.map(String).join(".") : "ambiente",
      message: issue.message,
    }));
    const details = normalizedIssues
      .map((issue) => `- ${issue.path}: ${issue.message}`)
      .join("\n");
    super(`Configuração de ambiente inválida:\n${details}`);
    this.name = "EnvironmentValidationError";
    this.issues = normalizedIssues;
  }
}

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new EnvironmentValidationError(result.error.issues);
  return result.data;
}

/**
 * @typedef {object} ParsedCriticalEnvironment
 * @property {"development" | "test" | "production"} nodeEnv
 * @property {string} databaseUrl
 * @property {string} authSecret
 * @property {string} inviteTokenSecret
 * @property {string} adminSecret
 * @property {string} nextAuthUrl
 * @property {string} nextAuthOrigin
 * @property {string | null} rateLimitPepper
 * @property {string} legacyTokenAcceptUntil
 */

/**
 * @param {Record<string, string | undefined>} environment
 * @returns {ParsedCriticalEnvironment}
 */
export function parseCriticalEnvironment(environment) {
  return parse(criticalEnvironmentSchema, environment);
}

/** @param {unknown} value @returns {string} */
export function parseDatabaseUrl(value) {
  return parse(z.object({ DATABASE_URL: databaseUrlSchema }), { DATABASE_URL: value })
    .DATABASE_URL;
}

/**
 * @param {{ AUTH_SECRET?: unknown, NEXTAUTH_SECRET?: unknown }} environment
 * @returns {string}
 */
export function parseAuthSecret(environment) {
  return parse(authAliasesSchema, environment);
}

/** @param {unknown} value @returns {string} */
export function parseInviteTokenSecret(value) {
  return parse(
    z.object({ INVITE_TOKEN_SECRET: requiredSecretSchema }),
    { INVITE_TOKEN_SECRET: value }
  ).INVITE_TOKEN_SECRET;
}

/** @param {unknown} value @returns {string} */
export function parseAdminSecret(value) {
  return parse(z.object({ ADMIN_SECRET: requiredSecretSchema }), { ADMIN_SECRET: value })
    .ADMIN_SECRET;
}

/** @param {unknown} value @param {unknown} nodeEnv @returns {string} */
export function parseNextAuthOrigin(value, nodeEnv) {
  const parsed = parse(nextAuthEnvironmentSchema, {
    NEXTAUTH_URL: value,
    NODE_ENV: nodeEnv,
  });
  return new URL(parsed.NEXTAUTH_URL).origin;
}

/** @param {unknown} value @returns {string | null} */
export function parseRateLimitPepper(value) {
  return parse(
    z.object({ RATE_LIMIT_PEPPER: optionalSecretSchema }),
    { RATE_LIMIT_PEPPER: value }
  ).RATE_LIMIT_PEPPER ?? null;
}

/** @param {unknown} value @returns {string} */
export function parseLegacyTokenAcceptUntil(value) {
  return parse(
    z.object({ LEGACY_TOKEN_ACCEPT_UNTIL: legacyTokenAcceptUntilSchema }),
    { LEGACY_TOKEN_ACCEPT_UNTIL: value }
  ).LEGACY_TOKEN_ACCEPT_UNTIL;
}
