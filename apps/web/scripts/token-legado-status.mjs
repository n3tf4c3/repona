import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import {
  LEGACY_TOKEN_MIGRATION_HARD_END,
  parseDatabaseUrl,
} from "../env-schema.mjs";
import { decifrarCodigo } from "./inviteToken.mjs";
import {
  countTokenFormats,
  formatTokenStatus,
  tokenStatusExitCode,
} from "./tokenLegadoStatusPlan.mjs";

const sql = neon(parseDatabaseUrl(process.env.DATABASE_URL));
const rows = await sql`select invite_code_enc from casas`;
const codes = rows.map((row) => {
  try {
    // O plaintext existe apenas nesta expressão em memória e nunca vai a logs.
    return decifrarCodigo(row.invite_code_enc);
  } catch {
    return null;
  }
});
const counts = countTokenFormats(codes);
console.log(formatTokenStatus(counts));
process.exitCode = tokenStatusExitCode(
  counts,
  new Date(),
  new Date(LEGACY_TOKEN_MIGRATION_HARD_END)
);
