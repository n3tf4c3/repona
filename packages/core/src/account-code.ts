// Contrato compartilhado da única credencial da casa. O alfabeto tem 32
// símbolos sem caracteres visualmente ambíguos, portanto cada caractere entrega
// exatamente 5 bits. Novos tokens usam 26 caracteres = 130 bits, acima do piso
// de 128 bits recomendado para um bearer permanente. Tokens implantados de 8
// e intermediários de 12 caracteres ficam aceitos apenas no rollout legado.
export const CASA_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CASA_CODE_LENGTH = 26;
export const CASA_CODE_LEGACY_LENGTHS = [8, 12] as const;
export const CASA_CODE_ENTROPY_BITS = CASA_CODE_LENGTH * Math.log2(CASA_CODE_ALPHABET.length);

function codePattern(lengths: readonly number[]): RegExp {
  const alternatives = lengths
    .map((length) => `[${CASA_CODE_ALPHABET}]{${length}}`)
    .join("|");
  return new RegExp(`^(?:${alternatives})$`);
}

export const CASA_CODE_CURRENT_REGEX = codePattern([CASA_CODE_LENGTH]);
export const CASA_CODE_LEGACY_REGEX = codePattern(CASA_CODE_LEGACY_LENGTHS);
export const CASA_CODE_REGEX = codePattern([CASA_CODE_LENGTH, ...CASA_CODE_LEGACY_LENGTHS]);

export function isLegacyCasaCode(code: string): boolean {
  return CASA_CODE_LEGACY_REGEX.test(code.trim().toUpperCase());
}
