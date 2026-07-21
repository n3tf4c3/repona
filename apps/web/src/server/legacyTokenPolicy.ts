import { isLegacyCasaCode } from "@repona/core";
import { LEGACY_TOKEN_MIGRATION_HARD_END } from "../../env-schema.mjs";

const HARD_END_MS = Date.parse(LEGACY_TOKEN_MIGRATION_HARD_END);

export function legacyTokenMayAuthenticate(
  code: string,
  now: Date,
  acceptUntilIso: string
): boolean {
  if (!isLegacyCasaCode(code)) return true;
  const cutoffMs = Math.min(Date.parse(acceptUntilIso), HARD_END_MS);
  return Number.isFinite(cutoffMs) && now.getTime() < cutoffMs;
}

export function legacyTokenMayMigrate(code: string, now: Date): boolean {
  return isLegacyCasaCode(code) && now.getTime() < HARD_END_MS;
}

export function tokenRotationPolicyError(
  code: string,
  mode: "rotate" | "migrate",
  now: Date,
  hasCommittedReceipt: boolean
): "LEGACY_TOKEN_MIGRATION_EXPIRED" | "TOKEN_ROTATION_INVALID_MODE" | null {
  // Um recibo já comprometido não é uma nova autenticação pelo bearer antigo:
  // id+verifier recuperam o resultado mesmo depois do hard end.
  if (hasCommittedReceipt) return null;
  if (isLegacyCasaCode(code)) {
    return mode === "migrate" && legacyTokenMayMigrate(code, now)
      ? null
      : "LEGACY_TOKEN_MIGRATION_EXPIRED";
  }
  return mode === "migrate" ? "TOKEN_ROTATION_INVALID_MODE" : null;
}

export function legacyMigrationAliasValidUntil(): Date {
  return new Date(HARD_END_MS);
}

export function legacyMigrationHardEnd(): string {
  return LEGACY_TOKEN_MIGRATION_HARD_END;
}
