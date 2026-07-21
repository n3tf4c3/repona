import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EnvironmentValidationError,
  MIN_SECRET_LENGTH,
  parseAdminSecret,
  parseAuthSecret,
  parseCriticalEnvironment,
  parseDatabaseUrl,
  parseInviteTokenSecret,
  parseNextAuthOrigin,
  parseRateLimitPepper,
} from "../../env-schema.mjs";
import { adminSecretConfigurado, autorizadoAdmin } from "./auth/adminAuth";

const authSecret = "a".repeat(MIN_SECRET_LENGTH);
const inviteSecret = "i".repeat(MIN_SECRET_LENGTH);
const adminSecret = "m".repeat(MIN_SECRET_LENGTH);
const pepper = "p".repeat(MIN_SECRET_LENGTH);

test("DATABASE_URL aceita somente PostgreSQL", () => {
  assert.equal(
    parseDatabaseUrl("postgresql://user:pass@db.example/repona"),
    "postgresql://user:pass@db.example/repona"
  );
  assert.equal(
    parseDatabaseUrl("postgres://user:pass@db.example/repona"),
    "postgres://user:pass@db.example/repona"
  );
  assert.throws(() => parseDatabaseUrl("https://db.example/repona"), /DATABASE_URL.*postgres/i);
  assert.throws(() => parseDatabaseUrl("mysql://db.example/repona"), /DATABASE_URL.*postgres/i);
  assert.throws(() => parseDatabaseUrl(undefined), /DATABASE_URL/i);
});

test("ADMIN_SECRET e INVITE_TOKEN_SECRET compartilham o mínimo de 32 caracteres", () => {
  const short = "x".repeat(MIN_SECRET_LENGTH - 1);

  assert.equal(parseAdminSecret(adminSecret), adminSecret);
  assert.equal(parseInviteTokenSecret(inviteSecret), inviteSecret);
  assert.throws(() => parseAdminSecret(short), /ADMIN_SECRET.*32/i);
  assert.throws(() => parseInviteTokenSecret(short), /INVITE_TOKEN_SECRET.*32/i);
});

test("AUTH_SECRET e NEXTAUTH_SECRET aceitam alias único e exigem igualdade quando ambos existem", () => {
  assert.equal(parseAuthSecret({ AUTH_SECRET: authSecret }), authSecret);
  assert.equal(parseAuthSecret({ NEXTAUTH_SECRET: authSecret }), authSecret);
  assert.equal(
    parseAuthSecret({ AUTH_SECRET: authSecret, NEXTAUTH_SECRET: authSecret }),
    authSecret
  );

  assert.throws(
    () => parseAuthSecret({ AUTH_SECRET: authSecret, NEXTAUTH_SECRET: "n".repeat(32) }),
    /NEXTAUTH_SECRET.*idêntico/i
  );
  assert.throws(() => parseAuthSecret({}), /AUTH_SECRET/i);
  assert.throws(
    () => parseAuthSecret({ AUTH_SECRET: "curto", NEXTAUTH_SECRET: authSecret }),
    /AUTH_SECRET.*32/i
  );
});

test("NEXTAUTH_URL permite HTTP local, mas exige HTTPS em produção", () => {
  assert.equal(parseNextAuthOrigin("http://localhost:3000/login", "development"), "http://localhost:3000");
  assert.equal(parseNextAuthOrigin("https://repona.example/login", "production"), "https://repona.example");
  assert.throws(
    () => parseNextAuthOrigin("http://repona.example", "production"),
    /NEXTAUTH_URL.*https/i
  );
  assert.throws(
    () => parseNextAuthOrigin("ftp://repona.example", "development"),
    /NEXTAUTH_URL.*http/i
  );
});

test("RATE_LIMIT_PEPPER é opcional, mas valor definido precisa ser forte", () => {
  assert.equal(parseRateLimitPepper(undefined), null);
  assert.equal(parseRateLimitPepper(""), null);
  assert.equal(parseRateLimitPepper(pepper), pepper);
  assert.throws(
    () => parseRateLimitPepper("p".repeat(MIN_SECRET_LENGTH - 1)),
    /RATE_LIMIT_PEPPER.*32/i
  );
});

test("schema completo valida o mesmo contrato usado pelos consumidores", () => {
  const parsed = parseCriticalEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:pass@db.example/repona",
    AUTH_SECRET: authSecret,
    NEXTAUTH_SECRET: authSecret,
    INVITE_TOKEN_SECRET: inviteSecret,
    ADMIN_SECRET: adminSecret,
    NEXTAUTH_URL: "https://repona.example/app",
    RATE_LIMIT_PEPPER: pepper,
  });

  assert.equal(parsed.nodeEnv, "production");
  assert.equal(parsed.authSecret, authSecret);
  assert.equal(parsed.nextAuthOrigin, "https://repona.example");
  assert.equal(parsed.rateLimitPepper, pepper);
});

test("erro agregado identifica variáveis, sem incluir valores sensíveis", () => {
  const leakedValue = "segredo-que-nao-pode-aparecer";

  assert.throws(
    () =>
      parseCriticalEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "https://db.example/repona",
        AUTH_SECRET: leakedValue,
        NEXTAUTH_SECRET: "outro-segredo-curto",
        INVITE_TOKEN_SECRET: "curto",
        ADMIN_SECRET: "curto",
        NEXTAUTH_URL: "http://repona.example",
      }),
    (error: unknown) => {
      assert.ok(error instanceof EnvironmentValidationError);
      assert.match(error.message, /DATABASE_URL/);
      assert.match(error.message, /INVITE_TOKEN_SECRET/);
      assert.match(error.message, /ADMIN_SECRET/);
      assert.match(error.message, /NEXTAUTH_URL/);
      assert.doesNotMatch(error.message, new RegExp(leakedValue));
      return true;
    }
  );
});

test("middleware/admin aplica o mesmo mínimo e permanece fail-closed", () => {
  const original = process.env.ADMIN_SECRET;
  try {
    process.env.ADMIN_SECRET = "m".repeat(MIN_SECRET_LENGTH - 1);
    assert.equal(adminSecretConfigurado(), false);
    assert.equal(autorizadoAdmin(null), false);

    process.env.ADMIN_SECRET = adminSecret;
    assert.equal(adminSecretConfigurado(), true);
    const authorization = `Basic ${Buffer.from(`operador:${adminSecret}`).toString("base64")}`;
    assert.equal(autorizadoAdmin(authorization), true);
  } finally {
    if (original === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = original;
  }
});
