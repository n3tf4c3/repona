// Mutex global da reserva de credenciais. Precisa ser um statement separado da
// mutação: em READ COMMITTED, o segundo statement ganha snapshot novo depois de
// esperar o concorrente, enquanto um CTE no mesmo statement manteria o antigo.
export const CREDENTIAL_TOKEN_LOCK_NAMESPACE = 7100;
export const CREDENTIAL_TOKEN_LOCK_KEY = 71;

export function credentialTokenLockRawQuery(): { query: string; params: unknown[] } {
  return {
    query: "select pg_advisory_xact_lock($1::int, $2::int)",
    params: [CREDENTIAL_TOKEN_LOCK_NAMESPACE, CREDENTIAL_TOKEN_LOCK_KEY],
  };
}
