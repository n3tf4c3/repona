import "server-only";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";
import { databaseUrl } from "@/server/env";

type DB = ReturnType<typeof drizzle<typeof schema>>;

let instance: DB | null = null;

function getDb(): DB {
  if (!instance) {
    instance = drizzle({ client: neon(databaseUrl()), schema });
  }
  return instance;
}

// Proxy preguiçoso: só lê DATABASE_URL quando uma query é de fato executada,
// evitando falhar no import durante o build (sem env configurado).
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const inst = getDb() as unknown as Record<string | symbol, unknown>;
    const value = inst[prop];
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(inst)
      : value;
  },
});
