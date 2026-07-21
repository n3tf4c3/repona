const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CURRENT = new RegExp(`^[${ALPHABET}]{26}$`);
const LEGACY = new RegExp(`^(?:[${ALPHABET}]{8}|[${ALPHABET}]{12})$`);

export function countTokenFormats(codes) {
  const result = { current: 0, legacy: 0, invalid: 0 };
  for (const code of codes) {
    if (typeof code === "string" && CURRENT.test(code)) result.current += 1;
    else if (typeof code === "string" && LEGACY.test(code)) result.legacy += 1;
    else result.invalid += 1;
  }
  return result;
}

export function formatTokenStatus({ current, legacy, invalid }) {
  return `atuais=${current} legados=${legacy} invalidos=${invalid}`;
}

export function tokenStatusExitCode(counts, now, hardEnd) {
  if (counts.invalid > 0) return 3;
  return now.getTime() >= hardEnd.getTime() && counts.legacy > 0 ? 2 : 0;
}
