import "server-only";
import { randomInt } from "crypto";
import { CASA_CODE_ALPHABET, CASA_CODE_LENGTH, CASA_CODE_REGEX } from "@repona/core";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { accountOperations, casas, purchaseHistory } from "@/server/db/schema";
import { cifrarCodigo, decifrarCodigo } from "@/server/inviteToken";
import { fingerprintToken } from "@/server/rateLimitToken";
import {
  assertSameAccountOperation,
  IDEMPOTENCY_CONFLICT,
  IDEMPOTENCY_RESULT_GONE,
} from "./accountOperation";
import { buildCasaMutationLock } from "./casaMutationLock";

export { IDEMPOTENCY_CONFLICT, IDEMPOTENCY_RESULT_GONE } from "./accountOperation";

export type CasaDTO = {
  id: number;
  name: string;
  inviteCode: string;
};

// Código de acesso (token): base32 sem caracteres ambíguos (0/O/1/I). É a única
// credencial — nasce no mobile e é usado para entrar no web. Novos códigos têm
// 26 chars = 130 bits; o parser compartilhado ainda aceita o legado de 12 para
// instalações anteriores. (auditoria #71)
export const CASA_CODE_LEN = CASA_CODE_LENGTH;
export { CASA_CODE_REGEX };

function gerarCodigo(): string {
  let codigo = "";
  for (let i = 0; i < CASA_CODE_LEN; i++) {
    codigo += CASA_CODE_ALPHABET[randomInt(CASA_CODE_ALPHABET.length)];
  }
  return codigo;
}

// Formato do token da casa (mesmo alfabeto e comprimento de gerarCodigo).
// Exportado para as rotas validarem o header x-casa-code antes de usá-lo como
// chave de rate limit, evitando inflar rate_limits com valores arbitrários.
// (auditoria #54) O contrato é compartilhado por web/mobile via @repona/core
// para não voltar a divergir. (#71)

// Marcador Postgres de unique_violation. Cada caller ainda confirma a origem:
// criação consulta o recibo da operação antes de tratar como retry concorrente;
// se ele não existir, a única colisão restante é o token. Qualquer outro erro
// propaga de imediato, sem mascarar a causa. (auditoria #64, #90)
function ehViolacaoUnica(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function obterOperacao(operationId: string) {
  const [operation] = await db
    .select({
      operationType: accountOperations.operationType,
      requestHash: accountOperations.requestHash,
      resultTokenEnc: accountOperations.resultTokenEnc,
    })
    .from(accountOperations)
    .where(eq(accountOperations.operationId, operationId))
    .limit(1);
  return operation ?? null;
}

async function repetirCriacao(
  operationId: string,
  requestHash: string
): Promise<{ token: string; name: string; casaId: number } | null> {
  const operation = await obterOperacao(operationId);
  if (!operation) return null;
  assertSameAccountOperation(operation, "create", requestHash);
  if (!operation.resultTokenEnc) throw new Error(IDEMPOTENCY_CONFLICT);

  const [casa] = await db
    .select({ id: casas.id, name: casas.name })
    .from(casas)
    .where(eq(casas.inviteCodeEnc, operation.resultTokenEnc))
    .limit(1);
  // Só ocorreria se alguém repetisse uma operação de criação muito antiga após
  // a casa ter sido excluída. Não criamos outra casa com a mesma chave.
  if (!casa) throw new Error(IDEMPOTENCY_RESULT_GONE);
  return { token: decifrarCodigo(operation.resultTokenEnc), name: casa.name, casaId: casa.id };
}

// Cria a conta (= casa) com o nome escolhido no mobile e devolve o token e o
// casaId. O mobile guarda o casaId para escopar seus dados por casa (arquivo
// SQLite por casa) e nunca misturar dados entre contas. (auditoria #68)
export async function criarContaNuvem(
  nome: string,
  operationId: string
): Promise<{ token: string; name: string; casaId: number }> {
  const name = nome.normalize("NFC").trim();
  if (!name) throw new Error("NOME_INVALIDO");
  const requestHash = fingerprintToken(name, "account-create");

  const replay = await repetirCriacao(operationId, requestHash);
  if (replay) return replay;

  // A operação e a casa entram no mesmo batch transacional. Se o HTTP cair
  // depois do commit, o retry encontra account_operations e devolve exatamente
  // o mesmo token/casaId. Se duas tentativas concorrerem, a PK da operação faz
  // uma delas falhar e então ela lê o resultado vencedor. (auditoria #90)
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const token = gerarCodigo();
    const tokenEnc = cifrarCodigo(token);
    try {
      const [, casasCriadas] = await db.batch([
        db.insert(accountOperations).values({
          operationId,
          operationType: "create",
          requestHash,
          resultTokenEnc: tokenEnc,
        }),
        db.insert(casas).values({ name, inviteCodeEnc: tokenEnc }).returning({ id: casas.id }),
      ]);
      const casa = casasCriadas[0];
      if (!casa) throw new Error("CASA_CREATE_FAILED");
      return { token, name, casaId: casa.id };
    } catch (error) {
      if (!ehViolacaoUnica(error)) throw error;

      // Pode ser a mesma operação concorrente ou uma raríssima colisão do token.
      // No primeiro caso repetimos o resultado; no segundo geramos outro token.
      const concurrentReplay = await repetirCriacao(operationId, requestHash);
      if (concurrentReplay) return concurrentReplay;
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
      if (!ehViolacaoUnica(error) || tentativa === 4) throw error;
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
    db.execute(buildCasaMutationLock(casaId)),
    db.delete(purchaseHistory).where(eq(purchaseHistory.casaId, casaId)),
    db.delete(casas).where(eq(casas.id, casaId)),
  ]);
}

// Variante pública usada pelo mobile: autentica pelo token e grava um recibo
// durável na mesma transação da exclusão. Um retry com a mesma chave retorna
// sucesso mesmo que a casa já não exista; uma chave reutilizada com outro token
// retorna conflito. A operação não referencia casas por FK para sobreviver ao
// DELETE. (auditoria #90)
export async function excluirContaNuvem(code: string, operationId: string): Promise<void> {
  const codigo = code.trim().toUpperCase();
  if (!CASA_CODE_REGEX.test(codigo)) throw new Error("CASA_NOT_FOUND");
  const requestHash = fingerprintToken(codigo, "account-delete");

  const replay = await obterOperacao(operationId);
  if (replay) {
    assertSameAccountOperation(replay, "delete", requestHash);
    return;
  }

  const casaId = await obterCasaPorCodigo(codigo);
  if (!casaId) throw new Error("CASA_NOT_FOUND");

  try {
    await db.batch([
      db.execute(buildCasaMutationLock(casaId)),
      db.insert(accountOperations).values({
        operationId,
        operationType: "delete",
        requestHash,
      }),
      db.delete(purchaseHistory).where(eq(purchaseHistory.casaId, casaId)),
      db.delete(casas).where(eq(casas.id, casaId)),
    ]);
  } catch (error) {
    if (!ehViolacaoUnica(error)) throw error;
    const concurrentReplay = await obterOperacao(operationId);
    if (!concurrentReplay) throw error;
    assertSameAccountOperation(concurrentReplay, "delete", requestHash);
  }
}
