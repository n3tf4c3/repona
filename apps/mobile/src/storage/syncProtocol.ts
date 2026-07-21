import {
  SYNC_COLLECTIONS,
  SYNC_PROTOCOL_VERSION,
  isBoundedSyncPage,
  syncSnapshotSize,
  type SyncCollection,
  type SyncSnapshot,
} from '@repona/core';
import { parseSyncSnapshot } from './syncSnapshot';

export type SyncV2UploadResponse = {
  casaId: number;
  ackPageId: string;
};

export type SyncV2DownloadResponse = {
  casaId: number;
  page: SyncSnapshot;
  collection: SyncCollection | null;
  nextCursor: string | null;
};

export type SyncV2HttpFailure =
  | 'UNSUPPORTED_PROTOCOL'
  | 'CASA_NOT_FOUND'
  | 'BUSY'
  | 'SYNC_LIMIT'
  | 'SERVER';

export type LegacySyncResponse = {
  casaId: number;
  snapshot: SyncSnapshot;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validCasaId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

// Um 404 do endpoint v2 em servidor antigo não tem o header de protocolo. Já
// um token inexistente respondido pela rota v2 tem o header `2`; essa distinção
// impede transformar CASA_NOT_FOUND em fallback ambíguo para o endpoint legado.
export function classifySyncV2HttpFailure(
  status: number,
  ok: boolean,
  protocolHeader: string | null,
): SyncV2HttpFailure | null {
  if (ok) return null;
  if (status === 404 && protocolHeader !== String(SYNC_PROTOCOL_VERSION)) {
    return 'UNSUPPORTED_PROTOCOL';
  }
  if (status === 404) return 'CASA_NOT_FOUND';
  if (status === 409 || status === 429) return 'BUSY';
  if (status === 413) return 'SYNC_LIMIT';
  return 'SERVER';
}

export function parseLegacySyncResponse(raw: unknown): LegacySyncResponse | null {
  const value = record(raw);
  if (!value || !validCasaId(value.casaId)) return null;
  const snapshot = parseSyncSnapshot(value);
  return snapshot ? { casaId: value.casaId, snapshot } : null;
}

function validEnvelope(value: Record<string, unknown>, phase: 'upload' | 'download'): boolean {
  return (
    value.protocolVersion === SYNC_PROTOCOL_VERSION &&
    value.phase === phase &&
    validCasaId(value.casaId) &&
    typeof value.serverTime === 'string' &&
    Number.isFinite(Date.parse(value.serverTime))
  );
}

export function parseSyncV2UploadResponse(
  raw: unknown,
  expectedPageId: string,
): SyncV2UploadResponse | null {
  const value = record(raw);
  if (
    !value ||
    !validEnvelope(value, 'upload') ||
    typeof value.ackPageId !== 'string' ||
    !UUID_RE.test(value.ackPageId) ||
    value.ackPageId !== expectedPageId
  ) {
    return null;
  }
  return { casaId: value.casaId as number, ackPageId: value.ackPageId };
}

export function parseSyncV2DownloadResponse(raw: unknown): SyncV2DownloadResponse | null {
  const value = record(raw);
  if (!value || !validEnvelope(value, 'download')) return null;
  if (
    value.nextCursor !== null &&
    (typeof value.nextCursor !== 'string' || value.nextCursor.length === 0 || value.nextCursor.length > 256)
  ) {
    return null;
  }
  const page = parseSyncSnapshot(value.page);
  if (!page) return null;
  const collection = value.collection;
  if (
    collection !== null &&
    (typeof collection !== 'string' || !SYNC_COLLECTIONS.includes(collection as SyncCollection))
  ) {
    return null;
  }
  if (
    collection === null
      ? value.nextCursor !== null || syncSnapshotSize(page) !== 0
      : !isBoundedSyncPage(page, collection as SyncCollection)
  ) {
    return null;
  }
  return {
    casaId: value.casaId as number,
    page,
    collection: collection as SyncCollection | null,
    nextCursor: value.nextCursor as string | null,
  };
}
