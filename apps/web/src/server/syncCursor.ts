import {
  SYNC_COLLECTIONS,
  isSyncHighWaterMarks,
  type SyncCollection,
  type SyncHighWaterMarks,
} from "@repona/core";

export type SyncCursor = {
  collection: SyncCollection;
  afterId: number;
  highWater?: SyncHighWaterMarks;
};

const MAX_CURSOR_LENGTH = 256;

export function encodeSyncCursor(cursor: SyncCursor): string {
  const marks = cursor.highWater;
  const wire = marks
    ? {
        v: 2,
        c: SYNC_COLLECTIONS.indexOf(cursor.collection),
        a: cursor.afterId,
        u: [
          marks.products,
          marks.purchases,
          marks.consumptions,
          marks.prices,
          marks.listItems,
          marks.activeListId,
        ],
      }
    : { v: 2, c: SYNC_COLLECTIONS.indexOf(cursor.collection), a: cursor.afterId };
  return Buffer.from(JSON.stringify(wire), "utf8").toString("base64url");
}

export function decodeSyncCursor(raw: string | null | undefined): SyncCursor | null {
  if (raw === null || raw === undefined || raw === "") {
    return { collection: SYNC_COLLECTIONS[0], afterId: 0 };
  }
  if (raw.length > MAX_CURSOR_LENGTH) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (candidate.v === 2) {
      if (
        typeof candidate.c !== "number" ||
        !Number.isInteger(candidate.c) ||
        candidate.c < 0 ||
        candidate.c >= SYNC_COLLECTIONS.length ||
        typeof candidate.a !== "number" ||
        !Number.isSafeInteger(candidate.a) ||
        candidate.a < 0
      ) {
        return null;
      }
      let highWater: SyncHighWaterMarks | undefined;
      if (candidate.u !== undefined) {
        if (
          !Array.isArray(candidate.u) ||
          candidate.u.length !== 6 ||
          !candidate.u.every(
            (mark) => typeof mark === "number" && Number.isSafeInteger(mark) && mark >= 0
          )
        ) {
          return null;
        }
        highWater = {
          products: candidate.u[0],
          purchases: candidate.u[1],
          consumptions: candidate.u[2],
          prices: candidate.u[3],
          listItems: candidate.u[4],
          activeListId: candidate.u[5],
        };
        if (!isSyncHighWaterMarks(highWater)) return null;
      }
      return {
        collection: SYNC_COLLECTIONS[candidate.c],
        afterId: candidate.a,
        highWater,
      };
    }

    // Compatibilidade com cursores emitidos durante o rollout inicial. A rota
    // captura um high-water ao recebê-los e todos os cursores seguintes já saem v2.
    if (
      typeof candidate.collection !== "string" ||
      !SYNC_COLLECTIONS.includes(candidate.collection as SyncCollection) ||
      typeof candidate.afterId !== "number" ||
      !Number.isSafeInteger(candidate.afterId) ||
      candidate.afterId < 0
    ) {
      return null;
    }
    return {
      collection: candidate.collection as SyncCollection,
      afterId: candidate.afterId,
    };
  } catch {
    return null;
  }
}

export function nextSyncCollection(collection: SyncCollection): SyncCollection | null {
  const index = SYNC_COLLECTIONS.indexOf(collection);
  return SYNC_COLLECTIONS[index + 1] ?? null;
}
