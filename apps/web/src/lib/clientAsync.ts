export const CLIENT_OPERATION_TIMEOUT_MS = 15_000;

export class ClientOperationTimeoutError extends Error {
  constructor() {
    super("CLIENT_OPERATION_TIMEOUT");
    this.name = "ClientOperationTimeoutError";
  }
}

/**
 * Impede que uma falha de transporte deixe a UI indefinidamente em estado
 * pendente. O timeout não tenta afirmar se uma mutação remota foi aplicada;
 * por isso a mensagem orienta recarregar os dados antes de repetir a ação.
 */
export async function withClientTimeout<T>(
  operation: Promise<T>,
  timeoutMs = CLIENT_OPERATION_TIMEOUT_MS
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new ClientOperationTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function transportErrorMessage(error: unknown): string {
  if (error instanceof ClientOperationTimeoutError) {
    return "A resposta demorou demais. Atualize a página antes de tentar novamente.";
  }
  return "A resposta foi interrompida. Tente novamente.";
}
