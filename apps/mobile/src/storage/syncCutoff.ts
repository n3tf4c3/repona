export const EVENT_UPLOAD_WINDOW_MS = 24 * 30 * 24 * 60 * 60 * 1000; // ~24 meses

// Mantém a janela móvel para eventos já sincronizados, mas nunca avança o
// cutoff além da última sincronização bem-sucedida. Se o aparelho ficar offline
// por mais de 24 meses, tudo que ocorreu desde o último ACK continua elegível.
// Estado inválido falha aberto (null = sem cutoff), priorizando não perder dados.
export function syncEventCutoffIso(
  lastSuccessfulSyncAt: string | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (!lastSuccessfulSyncAt) return null;
  const lastSyncMs = Date.parse(lastSuccessfulSyncAt);
  if (!Number.isFinite(lastSyncMs) || !Number.isFinite(nowMs)) return null;
  const rollingWindowMs = nowMs - EVENT_UPLOAD_WINDOW_MS;
  return new Date(Math.min(lastSyncMs, rollingWindowMs)).toISOString();
}

function isAtOrAfterCutoff(value: string, cutoffIso: string): boolean {
  const valueMs = Date.parse(value);
  const cutoffMs = Date.parse(cutoffIso);
  // Datas locais inválidas não devem provocar perda silenciosa: o servidor fará
  // a validação canônica e o cliente receberá um erro explícito, se necessário.
  return !Number.isFinite(valueMs) || !Number.isFinite(cutoffMs) || valueMs >= cutoffMs;
}

export function shouldUploadPurchaseAfterCutoff(
  purchase: { purchasedAt: string; updatedAt: string | null; deleted: boolean },
  cutoffIso: string | null,
): boolean {
  if (purchase.deleted || cutoffIso === null) return true;
  return (
    isAtOrAfterCutoff(purchase.purchasedAt, cutoffIso) ||
    (purchase.updatedAt !== null && isAtOrAfterCutoff(purchase.updatedAt, cutoffIso))
  );
}
