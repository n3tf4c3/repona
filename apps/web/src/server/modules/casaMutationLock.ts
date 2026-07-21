import { sql, type SQL } from "drizzle-orm";
import { CASA_MUTATION_LOCK_NAMESPACE } from "../../../casa-mutation-lock.mjs";

// Namespace inteiro estavel para o mutex transacional por casa ("RPNA"). A
// variante de dois int4 evita colisao com advisory locks de outros subsistemas.
export { CASA_MUTATION_LOCK_NAMESPACE } from "../../../casa-mutation-lock.mjs";

export function casaMutationLockRawQuery(casaId: number): {
  query: string;
  params: unknown[];
} {
  return {
    query: "select pg_advisory_xact_lock($1::int, $2::int)",
    params: [CASA_MUTATION_LOCK_NAMESPACE, casaId],
  };
}

export function buildCasaMutationLock(casaId: number): SQL {
  return sql`select pg_advisory_xact_lock(${CASA_MUTATION_LOCK_NAMESPACE}, ${casaId})`;
}
