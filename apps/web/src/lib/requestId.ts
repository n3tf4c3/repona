const SAFE_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Mantem apenas um identificador opaco e sintaticamente seguro. Nao deriva o
 * valor de token, IP, casaId ou payload; entradas alteradas/injetadas recebem
 * um UUID novo do servidor.
 */
export function safeRequestId(
  candidate: string | null | undefined,
  generate: () => string = () => crypto.randomUUID()
): string {
  return candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : generate();
}
