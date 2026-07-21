// Contrato compartilhado da única credencial da casa. O alfabeto tem 32
// símbolos sem caracteres visualmente ambíguos, portanto cada caractere entrega
// exatamente 5 bits. Novos tokens usam 26 caracteres = 130 bits, acima do piso
// de 128 bits recomendado para um bearer permanente. Tokens de 12 caracteres
// ficam aceitos apenas para compatibilidade de instalações anteriores. (#71)
export const CASA_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CASA_CODE_LENGTH = 26;
export const CASA_CODE_LEGACY_LENGTHS = [12] as const;
export const CASA_CODE_ENTROPY_BITS = CASA_CODE_LENGTH * Math.log2(CASA_CODE_ALPHABET.length);

const patterns = [CASA_CODE_LENGTH, ...CASA_CODE_LEGACY_LENGTHS]
  .map((length) => `[${CASA_CODE_ALPHABET}]{${length}}`)
  .join("|");
export const CASA_CODE_REGEX = new RegExp(`^(?:${patterns})$`);
