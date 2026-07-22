import "server-only";
import { randomInt } from "crypto";
import { CASA_CODE_ALPHABET, CASA_CODE_LENGTH, CASA_CODE_REGEX } from "@repona/core";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { casas, purchaseHistory } from "@/server/db/schema";
import { cifrarCodigo, decifrarCodigo } from "@/server/inviteToken";

export type CasaDTO = {
  id: number;
  name: string;
  inviteCode: string;
};

// Código de acesso (token): base32 sem caracteres ambíguos (0/O/1/I). É a única
// credencial — nasce no mobile e é usado para entrar no web.
export const CASA_CODE_LEN = CASA_CODE_LENGTH;
export { CASA_CODE_REGEX };

function gerarCodigo(): string {
  let codigo = "";
  for (let i = 0; i < CASA_CODE_LEN; i++) {
    codigo += CASA_CODE_ALPHABET[randomInt(CASA_CODE_ALPHABET.length)];
  }
  return codigo;
}

// Marcador Postgres de unique_violation: colisão do token gerado. Qualquer outro
// erro propaga de imediato, sem mascarar a causa.
function ehViolacaoUnica(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

// Cria a conta (= casa) com o nome escolhido no mobile e devolve o token e o
// casaId. O mobile guarda o casaId para escopar seus dados por casa (arquivo
// SQLite por casa) e nunca misturar dados entre contas. (auditoria #68)
export async function criarContaNuvem(
  nome: string
): Promise<{ token: string; name: string; casaId: number }> {
  const name = nome.normalize("NFC").trim();
  if (!name) throw new Error("NOME_INVALIDO");
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const token = gerarCodigo();
    try {
      const [casa] = await db
        .insert(casas)
        .values({ name, inviteCodeEnc: cifrarCodigo(token) })
        .returning({ id: casas.id });
      return { token, name, casaId: casa.id };
    } catch (error) {
      // Colisão rara do token candidato: tenta outro. Qualquer outro erro sobe.
      if (!ehViolacaoUnica(error)) throw error;
      if (tentativa === 4) throw error;
    }
  }
  throw new Error("CASA_CREATE_FAILED");
}

// Resolve a casa pelo token. Usado pela sincronização do mobile.
export async function obterCasaPorCodigo(code: string): Promise<number | null> {
  const codigo = code.trim().toUpperCase();
  if (!CASA_CODE_REGEX.test(codigo)) return null;
  const [casa] = await db
    .select({ id: casas.id })
    .from(casas)
    .where(eq(casas.inviteCodeEnc, cifrarCodigo(codigo)))
    .limit(1);
  return casa?.id ?? null;
}

// Autentica no web pelo token: devolve id + nome + versão da credencial, ou null.
export async function autenticarCasa(
  code: string
): Promise<{ id: number; name: string; credentialVersion: number } | null> {
  const codigo = code.trim().toUpperCase();
  if (!CASA_CODE_REGEX.test(codigo)) return null;
  const [casa] = await db
    .select({ id: casas.id, name: casas.name, credentialVersion: casas.credentialVersion })
    .from(casas)
    .where(eq(casas.inviteCodeEnc, cifrarCodigo(codigo)))
    .limit(1);
  return casa ?? null;
}

// Versão atual da credencial da casa (para comparar com o JWT da sessão).
export async function obterCredentialVersion(casaId: number): Promise<number | null> {
  const [casa] = await db
    .select({ credentialVersion: casas.credentialVersion })
    .from(casas)
    .where(eq(casas.id, casaId))
    .limit(1);
  return casa?.credentialVersion ?? null;
}

export async function obterCasaPorId(casaId: number): Promise<CasaDTO> {
  const [casa] = await db
    .select({ id: casas.id, name: casas.name, inviteCodeEnc: casas.inviteCodeEnc })
    .from(casas)
    .where(eq(casas.id, casaId))
    .limit(1);
  if (!casa) throw new Error("CASA_NOT_FOUND");
  // Decifra só aqui, para a tela de perfil exibir/copiar o token.
  return { id: casa.id, name: casa.name, inviteCode: decifrarCodigo(casa.inviteCodeEnc) };
}

// Gera um novo token, invalida o anterior (logins/syncs e sessões web já
// emitidas, via credentialVersion) e DEVOLVE o novo token. A entrega do token
// novo é essencial: a sessão atual é invalidada e a página que exibiria o token
// exige justamente a sessão que acabou de cair — o cliente usa o retorno para
// reautenticar e mostrar/copiar o novo token. (auditoria #13)
export async function regenerarToken(
  casaId: number
): Promise<{ token: string; credentialVersion: number }> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const token = gerarCodigo();
    try {
      const [casa] = await db
        .update(casas)
        .set({
          inviteCodeEnc: cifrarCodigo(token),
          credentialVersion: sql`${casas.credentialVersion} + 1`,
        })
        .where(eq(casas.id, casaId))
        .returning({ credentialVersion: casas.credentialVersion });
      if (!casa) throw new Error("CASA_NOT_FOUND");
      return { token, credentialVersion: casa.credentialVersion };
    } catch (error) {
      if (!ehViolacaoUnica(error)) throw error;
      if (tentativa === 4) throw error;
    }
  }
  throw new Error("TOKEN_ROTATION_FAILED");
}

export async function renomearCasa(casaId: number, name: string): Promise<void> {
  const nome = name.trim();
  if (!nome) throw new Error("NOME_INVALIDO");
  await db.update(casas).set({ name: nome }).where(eq(casas.id, casaId));
}

// Exclui a conta (casa) e todos os dados associados. purchase_history primeiro
// — sua FK para products não tem onDelete cascade (schema.ts), logo bloquearia a
// remoção dos produtos — e depois a casa, que cascateia produtos, listas,
// estoque e itens. As duas escritas vão num único db.batch (o neon-http executa
// como UMA transação): se a remoção da casa falhar, o delete do histórico é
// revertido, evitando perda parcial de dados. (auditoria #45; exclusão de conta
// exigida pela Play)
export async function excluirCasa(casaId: number): Promise<void> {
  await db.batch([
    db.delete(purchaseHistory).where(eq(purchaseHistory.casaId, casaId)),
    db.delete(casas).where(eq(casas.id, casaId)),
  ]);
}

// Variante pública usada pelo mobile: autentica pelo token e exclui. Idempotente:
// um token que já não resolve nenhuma casa (exclusão anterior concluída) também
// retorna sucesso, pois o objetivo — a conta não existir — foi atingido.
export async function excluirContaNuvem(code: string): Promise<void> {
  const casaId = await obterCasaPorCodigo(code);
  if (casaId === null) return;
  await excluirCasa(casaId);
}
