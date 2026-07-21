import "server-only";
import { randomInt } from "crypto";
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
// credencial — nasce no mobile e é usado para entrar no web. 12 chars = ~60 bits
// de entropia (antes 8 = 40 bits, fraco para um bearer permanente). (auditoria #71)
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CASA_CODE_LEN = 12;

function gerarCodigo(): string {
  let codigo = "";
  for (let i = 0; i < CASA_CODE_LEN; i++) {
    codigo += ALFABETO[randomInt(ALFABETO.length)];
  }
  return codigo;
}

// Formato do token da casa (mesmo alfabeto e comprimento de gerarCodigo).
// Exportado para as rotas validarem o header x-casa-code antes de usá-lo como
// chave de rate limit, evitando inflar rate_limits com valores arbitrários.
// (auditoria #54) Construído a partir das constantes para não divergir. (#71)
export const CASA_CODE_REGEX = new RegExp(`^[${ALFABETO}]{${CASA_CODE_LEN}}$`);

// Postgres unique_violation: só a colisão do código único justifica gerar outro
// e tentar de novo. Qualquer outro erro (banco indisponível, timeout, outra
// constraint) deve propagar de imediato, sem mascarar a causa nem gastar os 5
// retries. (auditoria #64)
function ehColisaoDeCodigo(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function criarCasa(name: string): Promise<{ id: number; code: string }> {
  // Tenta algumas vezes em caso de colisão do código único.
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const code = gerarCodigo();
    try {
      const [casa] = await db
        .insert(casas)
        .values({ name, inviteCodeEnc: cifrarCodigo(code) })
        .returning({ id: casas.id });
      return { id: casa.id, code };
    } catch (error) {
      if (!ehColisaoDeCodigo(error) || tentativa === 4) throw error;
    }
  }
  throw new Error("CASA_CREATE_FAILED");
}

// Cria a conta (= casa) com o nome escolhido no mobile e devolve o token e o
// casaId. O mobile guarda o casaId para escopar seus dados por casa (arquivo
// SQLite por casa) e nunca misturar dados entre contas. (auditoria #68)
export async function criarContaNuvem(
  nome: string
): Promise<{ token: string; name: string; casaId: number }> {
  const name = nome.trim();
  if (!name) throw new Error("NOME_INVALIDO");
  const { id, code } = await criarCasa(name);
  return { token: code, name, casaId: id };
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
// emitidas, via credentialVersion) e DEVOLVE o novo token + a nova versão. A
// entrega do token novo é essencial: sem ela a rotação bloqueia a conta — a
// sessão atual é invalidada e a página que exibiria o token exige justamente a
// sessão que acabou de cair. O cliente usa o retorno para reautenticar e
// mostrar/copiar o novo token. (auditoria #13)
export async function regenerarCodigo(
  casaId: number
): Promise<{ token: string; credentialVersion: number }> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const novoCodigo = gerarCodigo();
    try {
      const [row] = await db
        .update(casas)
        .set({
          inviteCodeEnc: cifrarCodigo(novoCodigo),
          credentialVersion: sql`${casas.credentialVersion} + 1`,
        })
        .where(eq(casas.id, casaId))
        .returning({ credentialVersion: casas.credentialVersion });
      if (!row) throw new Error("CASA_NOT_FOUND");
      return { token: novoCodigo, credentialVersion: row.credentialVersion };
    } catch (error) {
      if (!ehColisaoDeCodigo(error) || tentativa === 4) throw error;
    }
  }
  throw new Error("CASA_CREATE_FAILED");
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
