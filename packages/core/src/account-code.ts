// Contrato compartilhado da única credencial da casa. O alfabeto tem 32
// símbolos sem caracteres visualmente ambíguos, portanto cada caractere entrega
// exatamente 5 bits. O token usa 26 caracteres = 130 bits, acima do piso de 128
// bits recomendado para um bearer permanente.
export const CASA_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CASA_CODE_LENGTH = 26;
export const CASA_CODE_REGEX = new RegExp(`^[${CASA_CODE_ALPHABET}]{${CASA_CODE_LENGTH}}$`);
