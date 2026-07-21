const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function isOperationVerifierCapableClient(value: string | null): boolean {
  const match = value?.trim().match(VERSION);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major > 1 ||
    (major === 1 && (minor > 2 || (minor === 2 && patch >= 0)));
}
