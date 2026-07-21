// Valida todas as variáveis críticas sem abrir conexão nem imprimir segredos.
// Uso:
//   npm run env:check
//   npm run env:check -- --production
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EnvironmentValidationError,
  parseCriticalEnvironment,
} from "../env-schema.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(appRoot, ".env.local"), quiet: true });
config({ path: resolve(appRoot, ".env"), quiet: true });

const forceProduction = process.argv.slice(2).includes("--production");
const environment = {
  ...process.env,
  NODE_ENV: forceProduction ? "production" : process.env.NODE_ENV,
};

try {
  const parsed = parseCriticalEnvironment(environment);
  console.log(`Ambiente crítico válido (${parsed.nodeEnv}).`);
  console.log(
    parsed.rateLimitPepper
      ? "RATE_LIMIT_PEPPER: dedicado e válido."
      : "RATE_LIMIT_PEPPER: ausente; será derivado de INVITE_TOKEN_SECRET via HKDF."
  );
} catch (error) {
  if (error instanceof EnvironmentValidationError) {
    console.error(error.message);
  } else {
    console.error("Falha inesperada ao validar o ambiente.");
  }
  process.exitCode = 1;
}
