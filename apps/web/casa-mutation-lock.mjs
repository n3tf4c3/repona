// Namespace advisory compartilhado pelo runtime Next e pelas ferramentas CLI.
// 0x52504E41 = "RPNA" e cabe no int4 exigido pela variante (int4, int4).
export const CASA_MUTATION_LOCK_NAMESPACE = 1_380_994_625;

export function casaMutationLockStatement(sql, casaId) {
  return sql`SELECT pg_advisory_xact_lock(${CASA_MUTATION_LOCK_NAMESPACE}, ${casaId}::int)`;
}
