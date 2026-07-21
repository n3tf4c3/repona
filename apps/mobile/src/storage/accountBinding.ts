import { CASA_CODE_REGEX } from '@repona/core';

export const ACCOUNT_BINDING_VERSION = 1 as const;

export type AccountBinding = {
  version: typeof ACCOUNT_BINDING_VERSION;
  code: string;
  casaId: number;
};

export type PendingCreateBinding = {
  version: typeof ACCOUNT_BINDING_VERSION;
  code: string;
  casaId: number;
};

function parseValue(raw: string | null): AccountBinding | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (
      candidate.version !== ACCOUNT_BINDING_VERSION ||
      typeof candidate.code !== 'string' ||
      !CASA_CODE_REGEX.test(candidate.code) ||
      typeof candidate.casaId !== 'number' ||
      !Number.isSafeInteger(candidate.casaId) ||
      candidate.casaId <= 0
    ) {
      return null;
    }
    return {
      version: ACCOUNT_BINDING_VERSION,
      code: candidate.code,
      casaId: candidate.casaId,
    };
  } catch {
    return null;
  }
}

export function parseAccountBinding(raw: string | null): AccountBinding | null {
  return parseValue(raw);
}

export function parsePendingCreateBinding(raw: string | null): PendingCreateBinding | null {
  return parseValue(raw);
}

export function serializeAccountBinding(code: string, casaId: number): string {
  return JSON.stringify({ version: ACCOUNT_BINDING_VERSION, code, casaId });
}
