import "server-only";
import { drizzle } from "drizzle-orm/neon-http";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import * as schema from "./schema";
import { databaseUrl } from "@/server/env";

type DB = ReturnType<typeof drizzle<typeof schema>>;
type NeonClient = NeonQueryFunction<false, false>;

let instance: DB | null = null;
let client: NeonClient | null = null;

function getClient(): NeonClient {
  if (!client) client = neon<false, false>(databaseUrl());
  return client;
}

function getDb(): DB {
  if (!instance) {
    instance = drizzle({ client: getClient(), schema });
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

export async function queryRaw<Row extends Record<string, unknown>>(
  query: string,
  params: unknown[]
): Promise<Row[]> {
  return (await getClient().query(query, params)) as Row[];
}

export async function transactionRaw(
  queries: ReadonlyArray<{ query: string; params: unknown[] }>
): Promise<Array<Array<Record<string, unknown>>>> {
  return (await getClient().transaction((transaction) =>
    queries.map(({ query, params }) => transaction.query(query, params))
  )) as Array<Array<Record<string, unknown>>>;
}
