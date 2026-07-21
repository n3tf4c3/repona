import "server-only";
import { randomInt } from "crypto";
import {
  CASA_CODE_ALPHABET,
  CASA_CODE_LENGTH,
  CASA_CODE_REGEX,
  isLegacyCasaCode,
} from "@repona/core";
import { eq } from "drizzle-orm";
import { db, queryRaw, transactionRaw } from "@/server/db";
import {
  accountOperations,
  casas,
  purchaseHistory,
} from "@/server/db/schema";
import { cifrarCodigo, decifrarCodigo } from "@/server/inviteToken";
import { fingerprintToken } from "@/server/rateLimitToken";
import { legacyTokenAcceptUntil } from "@/server/env";
import {
  legacyMigrationAliasValidUntil,
  legacyMigrationHardEnd,
  legacyTokenMayAuthenticate,
  tokenRotationPolicyError,
} from "@/server/legacyTokenPolicy";
import { credentialTokenLockRawQuery } from "./credentialTokenLock";
import {
  CREATE_ACCOUNT_WITH_RECEIPT_SQL,
  DELETE_ACCOUNT_WITH_RECEIPT_SQL,
  ROTATE_ACCOUNT_TOKEN_SQL,
} from "./credentialTokenSql";
import {
  hashAccountOperationRequest,
  hashOperationVerifier,
} from "@/server/operationVerifier";
import {
  assertDeleteAccountOperationReplay,
  assertRecoverableTokenOperation,
  IDEMPOTENCY_RESULT_GONE,
} from "./accountOperation";
import {
  buildCasaMutationLock,
  CASA_MUTATION_LOCK_NAMESPACE,
} from "./casaMutationLock";

export { IDEMPOTENCY_CONFLICT, IDEMPOTENCY_RESULT_GONE } from "./accountOperation";

export type CasaDTO = {
  id: number;
  name: string;
  inviteCode: string;
  legacyToken: boolean;
  legacyTokenAcceptUntil: string;
  legacyMigrationHardEnd: string;
};

// Código de acesso (token): base32 sem caracteres ambíguos (0/O/1/I). É a única
// credencial — nasce no mobile e é usado para entrar no web. Novos códigos têm
// 26 chars = 130 bits; o parser compartilhado ainda aceita os legados de 8/12
// apenas durante a janela explícita de migração. (auditoria #71)
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
      operationVersion: accountOperations.operationVersion,
      operationType: accountOperations.operationType,
      requestHash: accountOperations.requestHash,
      resultTokenEnc: accountOperations.resultTokenEnc,
      operationVerifierHash: accountOperations.operationVerifierHash,
    })
    .from(accountOperations)
    .where(eq(accountOperations.operationId, operationId))
    .limit(1);
  return operation ?? null;
}

async function repetirCriacao(
  operationId: string,
  requestHash: string,
  verifierHash: string
): Promise<{ token: string; name: string; casaId: number } | null> {
  const operation = await obterOperacao(operationId);
  if (!operation) return null;
  assertRecoverableTokenOperation(operation, "create", verifierHash, requestHash);

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
  operationId: string,
  operationVerifier: string
): Promise<{ token: string; name: string; casaId: number }> {
  const name = nome.normalize("NFC").trim();
  if (!name) throw new Error("NOME_INVALIDO");
  const requestHash = hashAccountOperationRequest(name, "create");
  const verifierHash = hashOperationVerifier(operationVerifier, "create");

  const replay = await repetirCriacao(operationId, requestHash, verifierHash);
  if (replay) return replay;

  // A operação e a casa entram no mesmo batch transacional. Se o HTTP cair
  // depois do commit, o retry encontra account_operations e devolve exatamente
  // o mesmo token/casaId. Se duas tentativas concorrerem, a PK da operação faz
  // uma delas falhar e então ela lê o resultado vencedor. (auditoria #90)
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const token = gerarCodigo();
    const tokenEnc = cifrarCodigo(token);
    try {
      // O lock global serializa a reserva entre tokens atuais e aliases de
      // migração. A PK de cada coluna isoladamente não impediria uma credencial
      // atual de outra casa colidir com um alias temporário.
      const [, createdRows] = await transactionRaw([
        credentialTokenLockRawQuery(),
        {
          query: CREATE_ACCOUNT_WITH_RECEIPT_SQL,
          params: [name, tokenEnc, operationId, requestHash, verifierHash],
        },
      ]);
      const casa = createdRows[0] as { id: number } | undefined;
      if (!casa) continue;
      return { token, name, casaId: Number(casa.id) };
    } catch (error) {
      if (!ehViolacaoUnica(error)) throw error;

      // Pode ser a mesma operação concorrente ou uma raríssima colisão do token.
      // No primeiro caso repetimos o resultado; no segundo geramos outro token.
      const concurrentReplay = await repetirCriacao(operationId, requestHash, verifierHash);
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
  if (!legacyTokenMayAuthenticate(codigo, new Date(), legacyTokenAcceptUntil())) return null;
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
  if (!legacyTokenMayAuthenticate(codigo, new Date(), legacyTokenAcceptUntil())) return null;
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
  const inviteCode = decifrarCodigo(casa.inviteCodeEnc);
  return {
    id: casa.id,
    name: casa.name,
    inviteCode,
    legacyToken: isLegacyCasaCode(inviteCode),
    legacyTokenAcceptUntil: legacyTokenAcceptUntil(),
    legacyMigrationHardEnd: legacyMigrationHardEnd(),
  };
}

// Gera um novo token, invalida o anterior (logins/syncs e sessões web já
// emitidas, via credentialVersion) e DEVOLVE o novo token + a nova versão. A
// entrega do token novo é essencial: sem ela a rotação bloqueia a conta — a
// sessão atual é invalidada e a página que exibiria o token exige justamente a
// sessão que acabou de cair. O cliente usa o retorno para reautenticar e
// mostrar/copiar o novo token. (auditoria #13)
export const LEGACY_TOKEN_MIGRATION_EXPIRED = "LEGACY_TOKEN_MIGRATION_EXPIRED";
export const TOKEN_ROTATION_INVALID_MODE = "TOKEN_ROTATION_INVALID_MODE";
export const TOKEN_ROTATION_RECEIPT_NOT_FOUND = "TOKEN_ROTATION_RECEIPT_NOT_FOUND";
export const INVALID_OPERATION_VERIFIER = "INVALID_OPERATION_VERIFIER";
export type TokenRotationMode = "rotate" | "migrate";

type TokenRotationResult = {
  token: string;
  casaId: number;
  credentialVersion: number;
};

async function repetirRotacao(
  operationId: string,
  requestHash: string,
  recoveryHash: string
): Promise<TokenRotationResult | null> {
  const operation = await obterOperacao(operationId);
  if (!operation) return null;
  assertRecoverableTokenOperation(operation, "rotate", recoveryHash, requestHash);

  const [casa] = await db
    .select({ id: casas.id, credentialVersion: casas.credentialVersion })
    .from(casas)
    .where(eq(casas.inviteCodeEnc, operation.resultTokenEnc))
    .limit(1);
  if (!casa) throw new Error(IDEMPOTENCY_RESULT_GONE);
  return {
    token: decifrarCodigo(operation.resultTokenEnc),
    casaId: casa.id,
    credentialVersion: casa.credentialVersion,
  };
}

export async function recuperarRotacaoPendente(
  operationId: string,
  operationVerifier: string
): Promise<TokenRotationResult> {
  const recoveryHash = hashOperationVerifier(operationVerifier, "rotate");
  const operation = await obterOperacao(operationId);
  if (!operation) throw new Error(TOKEN_ROTATION_RECEIPT_NOT_FOUND);
  try {
    assertRecoverableTokenOperation(operation, "rotate", recoveryHash);
  } catch {
    throw new Error(TOKEN_ROTATION_RECEIPT_NOT_FOUND);
  }
  const [casa] = await db
    .select({ id: casas.id, credentialVersion: casas.credentialVersion })
    .from(casas)
    .where(eq(casas.inviteCodeEnc, operation.resultTokenEnc))
    .limit(1);
  if (!casa) throw new Error(IDEMPOTENCY_RESULT_GONE);
  return {
    token: decifrarCodigo(operation.resultTokenEnc),
    casaId: casa.id,
    credentialVersion: casa.credentialVersion,
  };
}

async function contarAlvosRotacao(
  tokenEnc: string,
  mode: TokenRotationMode,
  now: Date
): Promise<number> {
  const [row] = await queryRaw<{ count: number | string }>(
    `select count(distinct casa_id) as count from (
       select id as casa_id from casas where invite_code_enc = $1
       union all
       select casa_id from casa_token_migration_aliases
        where $2 = 'migrate' and token_enc = $1 and valid_until > $3::timestamptz
     ) targets`,
    [tokenEnc, mode, now.toISOString()]
  );
  return Number(row?.count ?? 0);
}

// O recibo é consultado antes do lookup do token. Assim, se a resposta do
// commit sumir, o retry com a mesma operação recupera a credencial resultante.
export async function rotacionarCodigoIdempotente(
  code: string,
  operationId: string,
  mode: TokenRotationMode,
  operationVerifier: string,
  now = new Date()
): Promise<TokenRotationResult> {
  const codigo = code.trim().toUpperCase();
  if (!CASA_CODE_REGEX.test(codigo)) throw new Error("CASA_NOT_FOUND");
  if (mode !== "rotate" && mode !== "migrate") {
    throw new Error(TOKEN_ROTATION_INVALID_MODE);
  }
  const recoveryHash = hashOperationVerifier(operationVerifier, "rotate");
  const requestHash = hashAccountOperationRequest(`${mode}:${codigo}`, "rotate");
  const replay = await repetirRotacao(operationId, requestHash, recoveryHash);
  const policyError = tokenRotationPolicyError(codigo, mode, now, replay !== null);
  if (policyError) throw new Error(policyError);
  if (replay) return replay;

  const oldTokenEnc = cifrarCodigo(codigo);
  const initialTargets = await contarAlvosRotacao(oldTokenEnc, mode, now);
  if (initialTargets === 0) throw new Error("CASA_NOT_FOUND");
  if (initialTargets !== 1) throw new Error("AMBIGUOUS_CREDENTIAL");

  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const novoCodigo = gerarCodigo();
    const newTokenEnc = cifrarCodigo(novoCodigo);
    const graceUntil = legacyMigrationAliasValidUntil();
    try {
      const [, rotationRows] = await transactionRaw([
        credentialTokenLockRawQuery(),
        {
          query: ROTATE_ACCOUNT_TOKEN_SQL,
          params: [
            oldTokenEnc,
            newTokenEnc,
            operationId,
            requestHash,
            graceUntil.toISOString(),
            mode,
            now.toISOString(),
            recoveryHash,
          ],
        },
      ]);
      const rotated = rotationRows[0] as
        | { casa_id: number; credential_version: number }
        | undefined;
      if (rotated) {
        const receipt = await repetirRotacao(operationId, requestHash, recoveryHash);
        if (!receipt) throw new Error("TOKEN_ROTATION_FAILED");
        return receipt;
      }

      const concurrentReplay = await repetirRotacao(operationId, requestHash, recoveryHash);
      if (concurrentReplay) return concurrentReplay;
      const targets = await contarAlvosRotacao(oldTokenEnc, mode, now);
      if (targets === 0) throw new Error("CASA_NOT_FOUND");
      if (targets !== 1) throw new Error("AMBIGUOUS_CREDENTIAL");
      // O único motivo restante é colisão do token candidato; tenta outro.
    } catch (error) {
      if (!ehViolacaoUnica(error)) throw error;
      const concurrentReplay = await repetirRotacao(operationId, requestHash, recoveryHash);
      if (concurrentReplay) return concurrentReplay;
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
  const requestHash = hashAccountOperationRequest(codigo, "delete");

  const replay = await obterOperacao(operationId);
  if (replay) {
    assertDeleteAccountOperationReplay(
      replay,
      requestHash,
      fingerprintToken(codigo, "account-delete")
    );
    return;
  }

  // O replay vem antes da política temporal: uma resposta perdida continua
  // confirmável mesmo depois do cutoff, mas uma exclusão nova por bearer legado
  // não pode ultrapassar a janela normal de autenticação.
  if (!legacyTokenMayAuthenticate(codigo, new Date(), legacyTokenAcceptUntil())) {
    throw new Error("CASA_NOT_FOUND");
  }

  let uniqueViolation: unknown = null;
  try {
    const [, deletedRows] = await transactionRaw([
      // Precisa ser o primeiro statement. Depois de esperar create/rotate/delete,
      // READ COMMITTED abre snapshot novo para confirmar o current vencedor.
      credentialTokenLockRawQuery(),
      {
        query: DELETE_ACCOUNT_WITH_RECEIPT_SQL,
        params: [
          cifrarCodigo(codigo),
          operationId,
          requestHash,
          CASA_MUTATION_LOCK_NAMESPACE,
        ],
      },
    ]);
    if (deletedRows.length > 0) return;
  } catch (error) {
    if (!ehViolacaoUnica(error)) throw error;
    uniqueViolation = error;
  }

  // Uma chamada concorrente com a mesma operação pode ter concluído enquanto
  // aguardávamos o fencing. Só o recibo exato converte a ausência em sucesso.
  const concurrentReplay = await obterOperacao(operationId);
  if (concurrentReplay) {
    assertDeleteAccountOperationReplay(
      concurrentReplay,
      requestHash,
      fingerprintToken(codigo, "account-delete")
    );
    return;
  }
  if (uniqueViolation) throw uniqueViolation;
  throw new Error("CASA_NOT_FOUND");
}
