import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { parseDatabaseUrl } from "./env-schema.mjs";

config({ path: ".env.local" });
config({ path: ".env" });

// Mesma regra do runtime e dos CLIs: além de existir, precisa ser uma URL
// postgres:// ou postgresql://. (auditoria #89)
const url = parseDatabaseUrl(process.env.DATABASE_URL);

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
