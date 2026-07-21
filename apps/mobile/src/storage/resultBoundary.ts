// Mantém callbacks públicos baseados em resultados tipados: falhas inesperadas
// de adapters (SecureStore/SQLite/JSON) não podem escapar como Promise rejeitada.
export async function captureUnexpectedResult<T>(
  operation: () => Promise<T>,
  fallback: () => T,
  onUnexpected?: () => void,
): Promise<T> {
  try {
    return await operation();
  } catch {
    try {
      onUnexpected?.();
    } catch {
      // Telemetria é best-effort e nunca pode quebrar o contrato tipado da UI.
    }
    return fallback();
  }
}
