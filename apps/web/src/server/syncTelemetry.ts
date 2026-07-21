import { safeRequestId } from "@/lib/requestId";

export type SyncTelemetryEvent = {
  protocolVersion: 1 | 2;
  clientVersion: string;
  phase: "snapshot" | "upload" | "download" | "unknown";
  outcome: string;
  requestId: string;
};

export function syncRequestId(
  candidate: string | null | undefined,
  generate: () => string = () => crypto.randomUUID()
): string {
  return safeRequestId(candidate, generate);
}

// O caller fornece somente enums/versões já validados. Deliberadamente não há
// campos para token, casaId, IP, cursor, pageId ou conteúdo sincronizado. O
// requestId é aleatório e permite correlacionar servidor e aparelho sem usar
// qualquer identificador de domínio. (#83)
export function buildSyncTelemetryEvent(event: SyncTelemetryEvent): SyncTelemetryEvent {
  // Whitelist explicita: mesmo que um caller futuro passe propriedades extras
  // em runtime, token/payload/casaId nao atravessam a fronteira de log.
  return {
    protocolVersion: event.protocolVersion,
    clientVersion: event.clientVersion,
    phase: event.phase,
    outcome: event.outcome,
    requestId: event.requestId,
  };
}

export function logSyncTelemetry(event: SyncTelemetryEvent): void {
  console.info("sync_protocol_result", buildSyncTelemetryEvent(event));
}
