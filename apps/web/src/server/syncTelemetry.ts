export type SyncTelemetryEvent = {
  protocolVersion: 1 | 2;
  clientVersion: string;
  phase: "snapshot" | "upload" | "download" | "unknown";
  outcome: string;
};

// O caller fornece somente enums/versões já validados. Deliberadamente não há
// campos para token, casaId, IP, cursor, pageId ou conteúdo sincronizado.
export function buildSyncTelemetryEvent(event: SyncTelemetryEvent): SyncTelemetryEvent {
  return { ...event };
}

export function logSyncTelemetry(event: SyncTelemetryEvent): void {
  console.info("sync_protocol_result", buildSyncTelemetryEvent(event));
}
