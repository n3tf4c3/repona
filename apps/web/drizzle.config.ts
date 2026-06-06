import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL ausente. Defina a conexão (ex.: Neon) em .env.local antes de rodar comandos do Drizzle."
  );
}

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
