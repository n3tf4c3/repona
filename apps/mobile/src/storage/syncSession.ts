import {
  CASA_CODE_REGEX,
  SYNC_COLLECTIONS,
  isSyncHighWaterMarks,
  type SyncHighWaterMarks,
  type SyncSnapshot,
} from '@repona/core';

const SESSION_VERSION = 2 as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_FINGERPRINT_RE = /^[0-9a-f]{16}$/;

type SessionBase = {
  version: typeof SESSION_VERSION;
  code: string;
  uploadLocal: boolean;
  casaId?: number;
};

export type UploadSyncSession = SessionBase & {
  phase: 'upload';
  collectionIndex: number;
  afterId: number;
  cutoffIso: string | null;
  highWater: SyncHighWaterMarks;
  pendingPageId?: string;
  pendingPageFingerprint?: string;
};

export type DownloadSyncSession = SessionBase & {
  phase: 'download';
  cursor: string | null;
  complete: boolean;
};

export type SyncSession = UploadSyncSession | DownloadSyncSession;

function validCasaId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parseSyncSession(raw: string | null): SyncSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const session = value as Record<string, unknown>;
    if (
      session.version !== SESSION_VERSION ||
      typeof session.code !== 'string' ||
      !CASA_CODE_REGEX.test(session.code) ||
      typeof session.uploadLocal !== 'boolean' ||
      !(session.casaId === undefined || validCasaId(session.casaId))
    ) {
      return null;
    }
    if (session.phase === 'upload') {
      if (
        typeof session.collectionIndex !== 'number' ||
        !Number.isInteger(session.collectionIndex) ||
        session.collectionIndex < 0 ||
        session.collectionIndex > SYNC_COLLECTIONS.length ||
        typeof session.afterId !== 'number' ||
        !Number.isSafeInteger(session.afterId) ||
        session.afterId < 0 ||
        !(
          session.cutoffIso === null ||
          (typeof session.cutoffIso === 'string' && Number.isFinite(Date.parse(session.cutoffIso)))
        ) ||
        !isSyncHighWaterMarks(session.highWater) ||
        !(
          session.pendingPageId === undefined ||
          (typeof session.pendingPageId === 'string' && UUID_RE.test(session.pendingPageId))
        ) ||
        !(
          session.pendingPageFingerprint === undefined ||
          (typeof session.pendingPageFingerprint === 'string' &&
            PAGE_FINGERPRINT_RE.test(session.pendingPageFingerprint))
        ) ||
        (session.pendingPageId === undefined) !== (session.pendingPageFingerprint === undefined)
      ) {
        return null;
      }
      return session as UploadSyncSession;
    }
    if (session.phase === 'download') {
      if (
        typeof session.complete !== 'boolean' ||
        session.cursor !== null &&
        (typeof session.cursor !== 'string' || session.cursor.length === 0 || session.cursor.length > 256)
      ) {
        return null;
      }
      return session as DownloadSyncSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function createSyncSession(
  code: string,
  uploadLocal: boolean,
  cutoffIso: string | null,
  highWater: SyncHighWaterMarks | null,
): SyncSession {
  if (uploadLocal) {
    if (!highWater) throw new Error('SYNC_HIGH_WATER_REQUIRED');
    return {
      version: SESSION_VERSION,
      code,
      uploadLocal,
      phase: 'upload',
      collectionIndex: 0,
      afterId: 0,
      cutoffIso,
      highWater,
    };
  }
  return {
    version: SESSION_VERSION,
    code,
    uploadLocal,
    phase: 'download',
    cursor: null,
    complete: false,
  };
}

export function startDownload(session: UploadSyncSession): DownloadSyncSession {
  return {
    version: SESSION_VERSION,
    code: session.code,
    uploadLocal: session.uploadLocal,
    casaId: session.casaId,
    phase: 'download',
    cursor: null,
    complete: false,
  };
}

export function sessionMatches(session: SyncSession, code: string, uploadLocal: boolean): boolean {
  return session.code === code && session.uploadLocal === uploadLocal;
}

export type PendingPairSession = { code: string; casaId?: number };

// Durante o pareamento, a sessão global é a intenção durável antes de
// existir ACCOUNT_BINDING. Assim um crash depois de aplicar uma página (ou
// depois do download completo) consegue retomar e promover o mesmo token/casa.
export function pendingPairFromSession(session: SyncSession | null): PendingPairSession | null {
  if (!session || session.uploadLocal) return null;
  return session.casaId === undefined
    ? { code: session.code }
    : { code: session.code, casaId: session.casaId };
}

function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// Não é assinatura de segurança; é identidade estável e compacta para
// decidir se um pageId pendente ainda representa exatamente o mesmo payload.
export function syncPageFingerprint(snapshot: SyncSnapshot): string {
  const serialized = JSON.stringify(snapshot);
  return `${fnv1a(serialized, 0x811c9dc5)}${fnv1a(serialized, 0x9e3779b9)}`;
}
