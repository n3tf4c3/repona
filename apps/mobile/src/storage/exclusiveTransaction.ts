export type ExclusiveTransactionHost<TTransaction> = {
  withExclusiveTransactionAsync(operation: (transaction: TTransaction) => Promise<void>): Promise<void>;
  withTransactionAsync(operation: () => Promise<void>): Promise<void>;
};

// Fronteira pequena e testável para garantir que o callback de sync recebe e
// usa o handle exclusivo, em vez do handle raiz (que o Expo permite intercalar).
export function withExclusiveTransaction<TTransaction>(
  host: ExclusiveTransactionHost<TTransaction>,
  webFallback: boolean,
  operation: (transaction: TTransaction) => Promise<void>,
): Promise<void> {
  // expo-sqlite não implementa a transação exclusiva no Web. Mantemos o
  // suporte declarado do app nesse alvo com fallback explícito; Android/iOS,
  // onde a conta/sync é usada em produção, sempre passam pelo modo exclusivo.
  if (webFallback) {
    return host.withTransactionAsync(() => operation(host as unknown as TTransaction));
  }
  return host.withExclusiveTransactionAsync(operation);
}
