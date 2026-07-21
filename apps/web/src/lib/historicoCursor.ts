import { Buffer } from "node:buffer";

export type HistoricoCursor = {
  purchasedAt: string;
  sourceNameKey: string;
};

export function decodeHistoricoCursor(raw: string | undefined): HistoricoCursor | undefined {
  if (!raw || raw.length > 384) return undefined;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<HistoricoCursor>;
    const date = typeof value.purchasedAt === "string" ? new Date(value.purchasedAt) : null;
    if (
      !date ||
      Number.isNaN(date.getTime()) ||
      typeof value.sourceNameKey !== "string" ||
      value.sourceNameKey.length > 200
    ) {
      return undefined;
    }
    return { purchasedAt: date.toISOString(), sourceNameKey: value.sourceNameKey };
  } catch {
    return undefined;
  }
}

export function encodeHistoricoCursor(cursor: HistoricoCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}
