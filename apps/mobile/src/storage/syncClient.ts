import * as SecureStore from 'expo-secure-store';
import { getRandomBytesAsync, randomUUID as secureRandomUUID } from 'expo-crypto';
import {
  CASA_CODE_REGEX,
  SYNC_COLLECTIONS,
  SYNC_PROTOCOL_VERSION,
  emptySyncSnapshot,
  syncCollectionSize,
  uuidv4,
  type SyncSnapshot,
} from '@repona/core';
import { API_BASE_URL } from '../config';
import { getSetting, setSetting, deleteSetting } from './settings';
import {
  buildLocalSnapshot,
  buildLocalSyncPage,
  getLocalSyncCutoffIso,
  getLocalSyncHighWaterMarks,
  applySnapshot,
  parseSyncSnapshot,
} from './sync';
import { getActiveScope, setActiveScope, deleteScopeDatabase } from './database';
import {
  hasPendingDeleteOperation,
  pendingVerifiedOperationMatches,
  parsePendingCreateAck,
  pendingCreateAckMatches,
  resolveCreateOperation,
  resolveDeleteOperation,
  verifierFromRandomBytes,
  type PendingVerifiedOperation,
  type PendingCreateAck,
} from './accountOperations';
import { captureUnexpectedResult } from './resultBoundary';
import {
  classifySyncV2HttpFailure,
  parseLegacySyncResponse,
  parseSyncV2DownloadResponse,
  parseSyncV2UploadResponse,
  type SyncV2HttpFailure,
} from './syncProtocol';
import {
  parseAccountBinding,
  parsePendingCreateBinding,
  serializeAccountBinding,
  type AccountBinding,
} from './accountBinding';
import {
  createSyncSession,
  parseSyncSession,
  pendingPairFromSession,
  sessionMatches,
  startDownload,
  syncPageFingerprint,
  type SyncSession,
  type UploadSyncSession,
} from './syncSession';
import {
  completePendingLocalDelete,
  parsePendingLocalDelete,
  serializePendingLocalDelete,
  verifiedCasaIdForDelete,
} from './accountDeletion';
import { createPromiseMutex } from './promiseMutex';
import {
  resolveCreateAccountAction,
  resolvePairAccountAction,
  resolveUnpairAccountAction,
} from './accountFlowState';
import {
  reportMobileRemoteFailure,
  reportMobileUnexpectedFailure,
} from './mobileTelemetry';

const CASA_CODE_KEY = 'casa_code';
// casaId da casa pareada (auditoria #68): determina qual arquivo SQLite abrir, por
// isso mora fora dos arquivos por-casa, no SecureStore junto do token. null =
// não pareado (escopo 'local').
const ACTIVE_CASA_ID_KEY = 'active_casa_id';
const LAST_SYNC_KEY = 'last_sync_at';
const CREATE_ACCOUNT_OPERATION_KEY = 'pending_create_account_operation_id';
const DELETE_ACCOUNT_OPERATION_KEY = 'pending_delete_account_operation';
const SYNC_V2_SESSION_KEY = 'sync_v2_session_v1';
const ACCOUNT_BINDING_KEY = 'account_binding_v1';
const PENDING_CREATE_BINDING_KEY = 'pending_create_binding_v1';
const PENDING_LOCAL_DELETE_KEY = 'pending_local_delete_v1';
export const SYNC_V2_CLIENT_VERSION = '1.2.0';
const runAccountOperation = createPromiseMutex();

// Snapshot vazio: usado no pareamento para PUXAR os dados da casa sem ENVIAR
// nada do arquivo local ativo — o que impediria dados de outra conta/scratch de
// vazarem para a casa que está sendo pareada. (auditoria #68)
// O token da casa é a única credencial (sync, login web, exclusão de conta), por
// isso mora no armazenamento seguro do SO (Keychain/Keystore), não no SQLite
// comum — em aparelho comprometido ou backup local, o token não fica legível.
// (auditoria #53)
type CredentialState =
  | { kind: 'binding'; binding: AccountBinding }
  | { kind: 'pending-create'; binding: AccountBinding }
  | { kind: 'pending-create-request' }
  | { kind: 'pending-pair'; code: string; casaId?: number }
  | { kind: 'legacy-unverified'; code: string; casaId: number }
  | { kind: 'legacy-unbound'; code: string }
  | { kind: 'none' };

async function persistBinding(code: string, casaId: number): Promise<AccountBinding> {
  const serialized = serializeAccountBinding(code, casaId);
  // ÚNICA escrita autoritativa: token e arquivo nunca ficam de gerações
  // diferentes depois de crash. Limpezas abaixo são apenas legado/housekeeping.
  await SecureStore.setItemAsync(ACCOUNT_BINDING_KEY, serialized);
  await Promise.all([
    SecureStore.deleteItemAsync(PENDING_CREATE_BINDING_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(CASA_CODE_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(ACTIVE_CASA_ID_KEY).catch(() => {}),
    deleteSetting(CASA_CODE_KEY).catch(() => {}),
  ]);
  return parseAccountBinding(serialized)!;
}

async function persistPendingCreate(code: string, casaId: number): Promise<void> {
  await SecureStore.setItemAsync(
    PENDING_CREATE_BINDING_KEY,
    serializeAccountBinding(code, casaId),
  );
}

async function getCredentialState(): Promise<CredentialState> {
  const bindingRaw = await SecureStore.getItemAsync(ACCOUNT_BINDING_KEY);
  const binding = parseAccountBinding(bindingRaw);
  if (binding) return { kind: 'binding', binding };
  if (bindingRaw !== null) await SecureStore.deleteItemAsync(ACCOUNT_BINDING_KEY);

  const pendingRaw = await SecureStore.getItemAsync(PENDING_CREATE_BINDING_KEY);
  const pending = parsePendingCreateBinding(pendingRaw);
  if (pending) return { kind: 'pending-create', binding: pending };
  if (pendingRaw !== null) await SecureStore.deleteItemAsync(PENDING_CREATE_BINDING_KEY);

  // Um CREATE pode ter commitado e perdido a resposta. A intenção persistida
  // bloqueia pareamento/troca de conta até que o mesmo id+verifier seja refeito.
  if (await SecureStore.getItemAsync(CREATE_ACCOUNT_OPERATION_KEY) !== null) {
    return { kind: 'pending-create-request' };
  }

  // Pair é pull-only e ainda não possui binding antes da 1ª resposta. A
  // sessão global funciona como intent durável; depois de crash, syncNow retoma
  // sem pedir o token de novo e sem transformar o scratch em upload.
  const pairSession = pendingPairFromSession(
    parseSyncSession(await SecureStore.getItemAsync(SYNC_V2_SESSION_KEY)),
  );
  if (pairSession) return { kind: 'pending-pair', ...pairSession };

  let legacyCode = await SecureStore.getItemAsync(CASA_CODE_KEY);
  if (!legacyCode) {
    legacyCode = await getSetting(CASA_CODE_KEY);
    if (legacyCode && CASA_CODE_REGEX.test(legacyCode)) {
      await SecureStore.setItemAsync(CASA_CODE_KEY, legacyCode);
      await deleteSetting(CASA_CODE_KEY);
    }
  } else {
    await deleteSetting(CASA_CODE_KEY).catch(() => {});
  }
  if (!legacyCode || !CASA_CODE_REGEX.test(legacyCode)) return { kind: 'none' };

  const rawCasaId = await SecureStore.getItemAsync(ACTIVE_CASA_ID_KEY);
  const casaId = rawCasaId ? Number(rawCasaId) : NaN;
  if (Number.isSafeInteger(casaId) && casaId > 0) {
    // Versões antigas faziam duas writes (token, depois casaId). Mesmo ambos
    // presentes podem pertencer a gerações diferentes após crash; valida via
    // pull antes de transformar em vínculo autoritativo.
    return { kind: 'legacy-unverified', code: legacyCode, casaId };
  }
  // Sem casaId não há prova de que o SQLite ativo pertence ao token. O primeiro
  // sync legado será pull-only e só então criará o vínculo; nunca faz upload.
  return { kind: 'legacy-unbound', code: legacyCode };
}

async function getCasaCodeSeguro(): Promise<string | null> {
  const state = await getCredentialState();
  return state.kind === 'none' || state.kind === 'pending-create-request'
    ? null
    : state.kind === 'legacy-unbound' || state.kind === 'legacy-unverified' || state.kind === 'pending-pair'
      ? state.code
      : state.binding.code;
}

async function newVerifiedOperation(): Promise<PendingVerifiedOperation> {
  const verifier = verifierFromRandomBytes(await getRandomBytesAsync(32));
  return { operationId: secureRandomUUID(), verifier };
}

async function getOrCreateCreateOperation(): Promise<PendingVerifiedOperation> {
  const current = await SecureStore.getItemAsync(CREATE_ACCOUNT_OPERATION_KEY);
  const generated = current === null ? await newVerifiedOperation() : null;
  const operation = resolveCreateOperation(current, () => generated!);
  const serialized = JSON.stringify(operation);
  if (current === null) {
    await SecureStore.setItemAsync(CREATE_ACCOUNT_OPERATION_KEY, serialized);
  }
  return operation;
}

async function getOrCreateDeleteOperationId(casaCode: string): Promise<string> {
  const raw = await SecureStore.getItemAsync(DELETE_ACCOUNT_OPERATION_KEY);
  const operation = resolveDeleteOperation(raw, casaCode, secureRandomUUID);
  const serialized = JSON.stringify(operation);
  if (serialized !== raw) {
    await SecureStore.setItemAsync(DELETE_ACCOUNT_OPERATION_KEY, serialized);
  }
  return operation.operationId;
}

async function acknowledgeCreateOperation(
  operation: PendingCreateAck,
): Promise<void> {
  const current = await SecureStore.getItemAsync(CREATE_ACCOUNT_OPERATION_KEY);
  if (pendingCreateAckMatches(current, operation)) {
    await SecureStore.deleteItemAsync(CREATE_ACCOUNT_OPERATION_KEY);
  }
}

async function hasPendingRemoteDelete(): Promise<boolean> {
  return hasPendingDeleteOperation(
    await SecureStore.getItemAsync(DELETE_ACCOUNT_OPERATION_KEY),
  );
}

async function getActiveCasaId(): Promise<number | null> {
  const state = await getCredentialState();
  if (state.kind === 'binding' || state.kind === 'pending-create') {
    return verifiedCasaIdForDelete({ kind: state.kind, casaId: state.binding.casaId });
  }
  if (state.kind === 'pending-pair') {
    return verifiedCasaIdForDelete({ kind: state.kind, casaId: state.casaId });
  }
  return verifiedCasaIdForDelete({
    kind: state.kind === 'legacy-unverified' ? 'legacy-unverified' : 'other',
    casaId: state.kind === 'legacy-unverified' ? state.casaId : undefined,
  });
}

async function clearCredentialsAfterLocalDelete(): Promise<void> {
  // ACCOUNT_BINDING é removido por último: se uma limpeza intermediária
  // falhar, o vínculo autoritativo continua recuperável junto do marcador.
  await deleteSetting(CASA_CODE_KEY);
  await SecureStore.deleteItemAsync(PENDING_CREATE_BINDING_KEY);
  await SecureStore.deleteItemAsync(SYNC_V2_SESSION_KEY);
  await SecureStore.deleteItemAsync(CASA_CODE_KEY);
  await SecureStore.deleteItemAsync(ACTIVE_CASA_ID_KEY);
  await SecureStore.deleteItemAsync(CREATE_ACCOUNT_OPERATION_KEY);
  await SecureStore.deleteItemAsync(DELETE_ACCOUNT_OPERATION_KEY);
  await SecureStore.deleteItemAsync(ACCOUNT_BINDING_KEY);
}

async function resumePendingLocalDelete(): Promise<void> {
  const raw = await SecureStore.getItemAsync(PENDING_LOCAL_DELETE_KEY);
  if (raw === null) return;
  const pending = parsePendingLocalDelete(raw);
  if (!pending) {
    await SecureStore.deleteItemAsync(PENDING_LOCAL_DELETE_KEY);
    return;
  }
  await completePendingLocalDelete(pending, {
    switchToLocal: () => setActiveScope('local'),
    deleteDatabase: (casaId) => deleteScopeDatabase(casaId),
    clearCredentials: clearCredentialsAfterLocalDelete,
    clearPending: () => SecureStore.deleteItemAsync(PENDING_LOCAL_DELETE_KEY),
  });
}

function runAccountFlow<T>(operation: () => Promise<T>): Promise<T> {
  return runAccountOperation(async () => {
    await resumePendingLocalDelete();
    return operation();
  });
}

// Restaura o arquivo SQLite ativo a partir do casaId pareado. Deve rodar no
// arranque do app, ANTES de qualquer leitura de dados, para não ler o scratch
// 'local' quando há uma casa pareada. (auditoria #68)
export function restoreActiveScope(): Promise<void> {
  return runAccountOperation(restoreActiveScopeUnsafe);
}

async function restoreActiveScopeUnsafe(): Promise<void> {
  // Se a nuvem já foi apagada, conclui a remoção local antes de sequer ler o
  // binding. O marcador só some no último passo e torna todos os crashes retomáveis.
  await resumePendingLocalDelete();
  const state = await getCredentialState();
  await setActiveScope(
    state.kind === 'binding'
      ? state.binding.casaId
      : state.kind === 'pending-pair' && state.casaId !== undefined
        ? state.casaId
        : 'local',
  );
}

// fetch com timeout via AbortController: sem isto uma conexão pendurada (rede
// ruim, servidor sem resposta) deixava criar/sincronizar/excluir travados para
// sempre, com a UI presa em loading. O abort rejeita e cai no catch de rede
// existente ('NETWORK'). (auditoria #83)
const REQUEST_TIMEOUT_MS = 15000;
async function fetchComTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type SyncResult =
  | { ok: true; lastSyncAt: string }
  | {
      ok: false;
      error:
        | 'NOT_PAIRED'
        | 'INVALID_CODE'
        | 'NETWORK'
        | 'CASA_NOT_FOUND'
        | 'BUSY'
        | 'SYNC_LIMIT'
        | 'ACCOUNT_STATE_CONFLICT'
        | 'SERVER';
    };

export type DeleteResult =
  | { ok: true }
  | { ok: false; error: 'NOT_PAIRED' | 'NETWORK' | 'CASA_NOT_FOUND' | 'SERVER' };

export async function getCasaCode(): Promise<string | null> {
  return getCasaCodeSeguro();
}

export async function getLastSyncAt(): Promise<string | null> {
  return getSetting(LAST_SYNC_KEY);
}

export function unpairCasa(): Promise<void> {
  return runAccountFlow(unpairCasaUnsafe);
}

async function unpairCasaUnsafe(): Promise<void> {
  if (
    hasPendingDeleteOperation(
      await SecureStore.getItemAsync(DELETE_ACCOUNT_OPERATION_KEY),
    )
  ) {
    throw new Error('PENDING_DELETE_OPERATION');
  }
  if (resolveUnpairAccountAction(await getCredentialState()).kind === 'reject') {
    throw new Error('PENDING_CREATE_OPERATION');
  }
  // Fecha primeiro o arquivo da casa. Se isso falhar, o binding ainda existe e
  // o boot consegue restaurá-lo; nunca ficamos sem credencial apontando ao DB aberto.
  await setActiveScope('local');
  await deleteSetting(CASA_CODE_KEY); // limpa um eventual token legado no scratch
  await SecureStore.deleteItemAsync(PENDING_CREATE_BINDING_KEY);
  await SecureStore.deleteItemAsync(SYNC_V2_SESSION_KEY);
  await SecureStore.deleteItemAsync(CASA_CODE_KEY);
  await SecureStore.deleteItemAsync(ACTIVE_CASA_ID_KEY);
  await SecureStore.deleteItemAsync(CREATE_ACCOUNT_OPERATION_KEY);
  await SecureStore.deleteItemAsync(DELETE_ACCOUNT_OPERATION_KEY);
  await SecureStore.deleteItemAsync(ACCOUNT_BINDING_KEY);
}

// Envia o snapshot local e aplica o snapshot mesclado que a nuvem devolve.
// O escopo já é o da casa ativa; build e apply operam no arquivo dela.
export function syncNow(): Promise<SyncResult> {
  return runAccountFlow(() =>
    captureUnexpectedResult(
      syncNowUnsafe,
      () => ({ ok: false, error: 'SERVER' }),
      () => reportMobileUnexpectedFailure('sync'),
    ),
  );
}

async function syncNowUnsafe(): Promise<SyncResult> {
  const state = await getCredentialState();
  if (state.kind === 'none' || state.kind === 'pending-create-request') {
    return { ok: false, error: 'NOT_PAIRED' };
  }
  let createOperation: PendingCreateAck | null = null;
  if (state.kind === 'pending-create') {
    try {
      // Captura o registro que esta tentativa efetivamente está confirmando.
      // O ACK posterior compara id+verifier e não pode apagar um sucessor.
      createOperation = parsePendingCreateAck(
        await SecureStore.getItemAsync(CREATE_ACCOUNT_OPERATION_KEY),
      );
    } catch {
      return { ok: false, error: 'SERVER' };
    }
  }

  const isLegacy = state.kind === 'legacy-unbound' || state.kind === 'legacy-unverified';
  const code = isLegacy || state.kind === 'pending-pair' ? state.code : state.binding.code;
  const uploadLocal = !isLegacy && state.kind !== 'pending-pair';
  // Um vínculo válido escolhe explicitamente o arquivo antes de QUALQUER leitura
  // de upload. Pending-create usa o scratch; legado sem casaId faz pull-only.
  await setActiveScope(
    state.kind === 'binding'
      ? state.binding.casaId
      : state.kind === 'pending-pair' && state.casaId !== undefined
        ? state.casaId
        : 'local',
  );
  const requiredCasaId =
    state.kind === 'binding' || state.kind === 'pending-create'
      ? state.binding.casaId
      : state.kind === 'pending-pair'
        ? state.casaId
        : undefined;
  const r = await runPagedSync(code, uploadLocal, requiredCasaId);
  if (!r.ok) return { ok: false, error: r.error };

  if (
    requiredCasaId !== undefined &&
    requiredCasaId !== r.casaId
  ) {
    return { ok: false, error: 'SERVER' };
  }
  if (state.kind !== 'binding') {
    await persistBinding(code, r.casaId);
    if (createOperation) await acknowledgeCreateOperation(createOperation).catch(() => {});
  }
  // A sessão `download complete` só deixa de ser a fonte de recuperação
  // DEPOIS que o binding atômico code+casaId foi promovido com sucesso.
  await SecureStore.deleteItemAsync(SYNC_V2_SESSION_KEY);
  return { ok: true, lastSyncAt: r.lastSyncAt };
}


// Nome padrão da conta. O nome é só um rótulo (não é credencial nem tem
// unicidade), então nasce automático para o usuário não precisar decidir nada
// ao ativar o backup — a única coisa que importa é o token que a nuvem devolve.
const NOME_PADRAO = 'Minha casa';

// Cria a conta na nuvem e devolve o token gerado, que fica salvo e é a
// credencial usada para acessar pelo web. Já faz a primeira sincronização.
// Sem parâmetros: o nome é automático (NOME_PADRAO) para o fluxo ser um toque só.
export function criarConta(): Promise<SyncResult> {
  return runAccountFlow(() =>
    captureUnexpectedResult(
      criarContaUnsafe,
      () => ({ ok: false, error: 'SERVER' }),
      () => reportMobileUnexpectedFailure('create-account'),
    ),
  );
}

async function resumePendingCreateSync(
  code: string,
  casaId: number,
  operation?: PendingVerifiedOperation,
): Promise<SyncResult> {
  await setActiveScope('local');
  const r = await runPagedSync(code, true, casaId);
  if (!r.ok) return { ok: false, error: r.error };
  if (r.casaId !== casaId) return { ok: false, error: 'SERVER' };
  await persistBinding(code, casaId);
  // O binding code+casaId já está durável; só agora o recibo de CREATE deixa
  // de ser necessário para recuperar uma resposta perdida.
  if (operation) {
    await acknowledgeCreateOperation({ kind: 'verified', operation }).catch(() => {});
  }
  await SecureStore.deleteItemAsync(SYNC_V2_SESSION_KEY).catch(() => {});
  return { ok: true, lastSyncAt: r.lastSyncAt };
}

async function criarContaUnsafe(): Promise<SyncResult> {
  if (await hasPendingRemoteDelete()) {
    return { ok: false, error: 'ACCOUNT_STATE_CONFLICT' };
  }
  const action = resolveCreateAccountAction(await getCredentialState());
  if (action.kind === 'reject') {
    return { ok: false, error: 'ACCOUNT_STATE_CONFLICT' };
  }
  if (action.kind === 'resume') {
    // O POST ja foi confirmado e token+casaId estao salvos. Um novo POST aqui
    // poderia criar uma segunda casa; o retry retoma somente a sync pendente.
    let operation: PendingVerifiedOperation;
    try {
      operation = await getOrCreateCreateOperation();
    } catch {
      return { ok: false, error: 'SERVER' };
    }
    return resumePendingCreateSync(action.code, action.casaId, operation);
  }

  // Cria a conta e MIGRA os dados locais (scratch) para ela: o snapshot local
  // atual vira o conteúdo inicial da casa nova. É dado do próprio usuário indo
  // para a própria conta nova — não é cruzamento entre casas. (auditoria #68)
  let operation: PendingVerifiedOperation;
  try {
    // Persistido ANTES do request. Se o servidor fizer commit e a resposta se
    // perder, a próxima tentativa reutiliza a chave e recebe a mesma casa/token.
    operation = await getOrCreateCreateOperation();
  } catch {
    return { ok: false, error: 'SERVER' };
  }

  let response: Response;
  try {
    response = await fetchComTimeout(`${API_BASE_URL}/api/casa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': operation.operationId,
        'x-operation-verifier': operation.verifier,
        'x-repona-client-version': SYNC_V2_CLIENT_VERSION,
        'x-request-id': secureRandomUUID(),
      },
      body: JSON.stringify({ nome: NOME_PADRAO }),
    });
  } catch {
    return { ok: false, error: 'NETWORK' };
  }

  if (!response.ok) {
    reportMobileRemoteFailure('create-account', response);
    return { ok: false, error: 'SERVER' };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    reportMobileRemoteFailure('create-account', response);
    return { ok: false, error: 'SERVER' };
  }
  const token = isRecord(data) ? data.token : undefined;
  const casaId = isRecord(data) ? data.casaId : undefined;
  if (
    typeof token !== 'string' ||
    !CASA_CODE_REGEX.test(token) ||
    typeof casaId !== 'number' ||
    !Number.isSafeInteger(casaId) ||
    casaId <= 0
  ) {
    // Mantém a operação pendente: um retry obtém o resultado memoizado correto.
    reportMobileRemoteFailure('create-account', response);
    return { ok: false, error: 'SERVER' };
  }
  // Persiste o token ANTES da primeira sincronização (auditoria #58). Ele é a
  // ÚNICA credencial da casa recém-criada e só existe aqui: se a primeira sync
  // falhar (timeout, 413, crash), salvá-lo só no fim perderia a credencial e
  // deixaria a casa órfã na nuvem. Salvo antes, a casa é recuperável e a UI —
  // vendo-se pareada — não reoferece "criar conta", evitando uma segunda casa.
  // O active_casa_id NÃO é gravado ainda: no arranque restoreActiveScope abre o
  // scratch 'local' (não a casa vazia), preservando os dados a enviar; a próxima
  // syncNow empurra o scratch e adota a casa. A Idempotency-Key persistida acima
  // também cobre a resposta perdida ANTES de recebermos o token. (#90)
  await persistPendingCreate(token, casaId);
  // Empurra o scratch para a casa nova e adota o merge no arquivo dela.
  return resumePendingCreateSync(token, casaId, operation);
}

// Conecta a uma casa existente PUXANDO os dados dela, sem enviar o arquivo local
// ativo (scratch ou outra casa) — envia snapshot vazio, recebe casaId + dados,
// troca para o arquivo da casa e aplica lá. Nenhum dado cruza de conta. O binding
// definitivo só nasce após o pull; durante falhas, a sessão preserva o token como
// intenção pendente para que um retry não consiga substituí-lo. (auditoria #68)
export function pairAndSync(code: string): Promise<SyncResult> {
  return runAccountFlow(() =>
    captureUnexpectedResult(
      () => pairAndSyncUnsafe(code),
      () => ({ ok: false, error: 'SERVER' }),
      () => reportMobileUnexpectedFailure('pair-account'),
    ),
  );
}

async function pairAndSyncUnsafe(code: string): Promise<SyncResult> {
  const normalized = code.trim().toUpperCase();
  if (!CASA_CODE_REGEX.test(normalized)) return { ok: false, error: 'INVALID_CODE' };
  if (await hasPendingRemoteDelete()) {
    return { ok: false, error: 'ACCOUNT_STATE_CONFLICT' };
  }

  const action = resolvePairAccountAction(await getCredentialState(), normalized);
  if (action.kind === 'reject') {
    return { ok: false, error: 'ACCOUNT_STATE_CONFLICT' };
  }

  // A sessao pull-only e a intencao duravel do pareamento. Se ela ja existe,
  // somente o mesmo token pode retoma-la e o casaId observado nao pode mudar.
  if (action.kind === 'start') {
    await saveSyncSession(createSyncSession(normalized, false, null, null));
  }
  const prepared = await getCredentialState();
  if (prepared.kind !== 'pending-pair') {
    return { ok: false, error: 'ACCOUNT_STATE_CONFLICT' };
  }
  const syncCode = prepared.code;
  const requiredCasaId = prepared.casaId;
  await setActiveScope(requiredCasaId ?? 'local');
  const r = await runPagedSync(syncCode, false, requiredCasaId);
  if (!r.ok) return { ok: false, error: r.error };
  if (requiredCasaId !== undefined && r.casaId !== requiredCasaId) {
    return { ok: false, error: 'SERVER' };
  }
  await persistBinding(syncCode, r.casaId);
  await SecureStore.deleteItemAsync(SYNC_V2_SESSION_KEY);
  return { ok: true, lastSyncAt: r.lastSyncAt };
}

// Exclui a conta na nuvem (todos os dados, para todos os aparelhos com este
// token) e remove também o arquivo local desta casa. (exigência da Play:
// exclusão de conta self-service)
export function excluirConta(): Promise<DeleteResult> {
  return runAccountFlow(() =>
    captureUnexpectedResult(
      excluirContaUnsafe,
      () => ({ ok: false, error: 'SERVER' }),
      () => reportMobileUnexpectedFailure('delete-account'),
    ),
  );
}

async function excluirContaUnsafe(): Promise<DeleteResult> {
  const code = await getCasaCode();
  if (!code) return { ok: false, error: 'NOT_PAIRED' };
  const casaId = await getActiveCasaId();
  // Sem identidade validada do arquivo não há como cumprir o contrato de
  // apagar localmente sem arriscar remover o scratch de outra geração.
  if (casaId === null) return { ok: false, error: 'SERVER' };

  let operationId: string;
  try {
    // O vínculo com casaCode impede reaproveitar uma operação pendente depois de
    // trocar de conta. Se a resposta do DELETE sumir após o commit, o retry usa
    // a mesma chave e o servidor devolve sucesso mesmo sem a casa. (#90)
    operationId = await getOrCreateDeleteOperationId(code);
  } catch {
    return { ok: false, error: 'SERVER' };
  }

  let response: Response;
  try {
    response = await fetchComTimeout(`${API_BASE_URL}/api/casa`, {
      method: 'DELETE',
      headers: {
        'x-casa-code': code,
        'Idempotency-Key': operationId,
        'x-request-id': secureRandomUUID(),
      },
    });
  } catch {
    return { ok: false, error: 'NETWORK' };
  }

  if (response.status === 404) {
    reportMobileRemoteFailure('delete-account', response);
    // Não migra/revincula após um único 404: uma tentativa anterior pode ainda
    // estar esperando o mutex e commitar com o hash legado. Mantém a intenção
    // para retry/recuperação operacional, sem risco de limpar a casa errada.
    return { ok: false, error: 'CASA_NOT_FOUND' };
  }
  if (!response.ok) {
    reportMobileRemoteFailure('delete-account', response);
    return { ok: false, error: 'SERVER' };
  }

  // Commit remoto confirmado: registra o cleanup ANTES de trocar escopo/apagar.
  // Se o processo morrer em qualquer linha seguinte, restoreActiveScope conclui.
  await SecureStore.setItemAsync(
    PENDING_LOCAL_DELETE_KEY,
    serializePendingLocalDelete(casaId),
  );
  await resumePendingLocalDelete();
  return { ok: true };
}

type PagedSyncError = 'NETWORK' | 'CASA_NOT_FOUND' | 'BUSY' | 'SYNC_LIMIT' | 'SERVER';
type V2PagedSyncError = PagedSyncError | 'UNSUPPORTED_PROTOCOL';
type PagedSyncResult =
  | { ok: true; casaId: number; lastSyncAt: string }
  | { ok: false; error: PagedSyncError };
type UploadPageResult =
  | { ok: true; casaId: number }
  | { ok: false; error: V2PagedSyncError };
type DownloadPageResult =
  | {
      ok: true;
      casaId: number;
      page: Awaited<ReturnType<typeof buildLocalSyncPage>>['snapshot'];
      nextCursor: string | null;
    }
  | { ok: false; error: V2PagedSyncError };

function syncV2HttpError(response: Response): SyncV2HttpFailure | null {
  return classifySyncV2HttpFailure(
    response.status,
    response.ok,
    response.headers.get('x-repona-sync-protocol'),
  );
}

async function postV2Upload(
  code: string,
  collection: (typeof SYNC_COLLECTIONS)[number],
  pageId: string,
  snapshot: Awaited<ReturnType<typeof buildLocalSyncPage>>['snapshot'],
  expectedCasaId?: number,
): Promise<UploadPageResult> {
  let response: Response;
  try {
    response = await fetchComTimeout(`${API_BASE_URL}/api/sync/v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-casa-code': code,
        'x-repona-sync-protocol': String(SYNC_PROTOCOL_VERSION),
        'x-repona-client-version': SYNC_V2_CLIENT_VERSION,
        'x-request-id': secureRandomUUID(),
      },
      body: JSON.stringify({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        phase: 'upload',
        collection,
        pageId,
        snapshot,
        expectedCasaId,
      }),
    });
  } catch {
    return { ok: false, error: 'NETWORK' };
  }
  const httpError = syncV2HttpError(response);
  if (httpError) {
    if (httpError !== 'UNSUPPORTED_PROTOCOL') {
      reportMobileRemoteFailure('sync', response);
    }
    return { ok: false, error: httpError };
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    reportMobileRemoteFailure('sync', response);
    return { ok: false, error: 'SERVER' };
  }
  const parsed = parseSyncV2UploadResponse(raw, pageId);
  if (!parsed) reportMobileRemoteFailure('sync', response);
  return parsed ? { ok: true, casaId: parsed.casaId } : { ok: false, error: 'SERVER' };
}

async function postV2Download(
  code: string,
  cursor: string | null,
  expectedCasaId?: number,
): Promise<DownloadPageResult> {
  let response: Response;
  try {
    response = await fetchComTimeout(`${API_BASE_URL}/api/sync/v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-casa-code': code,
        'x-repona-sync-protocol': String(SYNC_PROTOCOL_VERSION),
        'x-repona-client-version': SYNC_V2_CLIENT_VERSION,
        'x-request-id': secureRandomUUID(),
      },
      body: JSON.stringify({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        phase: 'download',
        cursor,
        expectedCasaId,
      }),
    });
  } catch {
    return { ok: false, error: 'NETWORK' };
  }
  const httpError = syncV2HttpError(response);
  if (httpError) {
    if (httpError !== 'UNSUPPORTED_PROTOCOL') {
      reportMobileRemoteFailure('sync', response);
    }
    return { ok: false, error: httpError };
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    reportMobileRemoteFailure('sync', response);
    return { ok: false, error: 'SERVER' };
  }
  const parsed = parseSyncV2DownloadResponse(raw);
  if (!parsed) reportMobileRemoteFailure('sync', response);
  return parsed ? { ok: true, ...parsed } : { ok: false, error: 'SERVER' };
}

async function saveSyncSession(session: SyncSession): Promise<void> {
  await SecureStore.setItemAsync(SYNC_V2_SESSION_KEY, JSON.stringify(session));
}

async function loadSyncSession(code: string, uploadLocal: boolean): Promise<SyncSession> {
  const raw = await SecureStore.getItemAsync(SYNC_V2_SESSION_KEY);
  const existing = parseSyncSession(raw);
  if (existing && sessionMatches(existing, code, uploadLocal)) return existing;
  if (raw !== null) await SecureStore.deleteItemAsync(SYNC_V2_SESSION_KEY);
  const [cutoffIso, highWater] = uploadLocal
    ? await Promise.all([getLocalSyncCutoffIso(), getLocalSyncHighWaterMarks()])
    : [null, null] as const;
  const session = createSyncSession(code, uploadLocal, cutoffIso, highWater);
  await saveSyncSession(session);
  return session;
}

type UploadPagesResult =
  | { ok: true; session: UploadSyncSession }
  | { ok: false; error: V2PagedSyncError };

async function uploadLocalPages(
  code: string,
  initial: UploadSyncSession,
  requiredCasaId?: number,
): Promise<UploadPagesResult> {
  let progress = initial;
  while (progress.collectionIndex < SYNC_COLLECTIONS.length) {
    const collection = SYNC_COLLECTIONS[progress.collectionIndex];
    const page = await buildLocalSyncPage(
      collection,
      progress.afterId,
      progress.cutoffIso,
      progress.highWater,
    );
    if (syncCollectionSize(page.snapshot, collection) === 0) {
      progress = {
        ...progress,
        collectionIndex: progress.collectionIndex + 1,
        afterId: 0,
        pendingPageId: undefined,
        pendingPageFingerprint: undefined,
      };
      await saveSyncSession(progress);
      continue;
    }

    const fingerprint = syncPageFingerprint(page.snapshot);
    const reusePendingPage =
      progress.pendingPageId !== undefined &&
      progress.pendingPageFingerprint === fingerprint;
    const pageId: string = reusePendingPage ? progress.pendingPageId! : uuidv4();
    if (!reusePendingPage) {
      progress = {
        ...progress,
        pendingPageId: pageId,
        pendingPageFingerprint: fingerprint,
      };
      await saveSyncSession(progress);
    }
    const result = await postV2Upload(
      code,
      collection,
      pageId,
      page.snapshot,
      requiredCasaId,
    );
    if (!result.ok) return result;
    if (progress.casaId !== undefined && progress.casaId !== result.casaId) {
      return { ok: false, error: 'SERVER' };
    }

    progress = {
      ...progress,
      casaId: result.casaId,
      collectionIndex:
        page.nextAfterId === null ? progress.collectionIndex + 1 : progress.collectionIndex,
      afterId: page.nextAfterId ?? 0,
      pendingPageId: undefined,
      pendingPageFingerprint: undefined,
    };
    await saveSyncSession(progress);
  }
  return { ok: true, session: progress };
}

async function runV2PagedSync(
  code: string,
  uploadLocal: boolean,
  requiredCasaId?: number,
): Promise<PagedSyncResult | { ok: false; error: 'UNSUPPORTED_PROTOCOL' }> {
  const originalScope = getActiveScope();
  let expectedCasaId: number | null = null;
  let switchedScope = false;
  let completed = false;

  try {
    let session = await loadSyncSession(code, uploadLocal);
    if (session.phase === 'upload') {
      const upload = await uploadLocalPages(code, session, requiredCasaId);
      if (!upload.ok) return upload;
      expectedCasaId = upload.session.casaId ?? null;
      if (expectedCasaId !== null && requiredCasaId !== undefined && expectedCasaId !== requiredCasaId) {
        return { ok: false, error: 'SERVER' };
      }
      session = startDownload(upload.session);
      await saveSyncSession(session);
    } else {
      expectedCasaId = session.casaId ?? null;
    }

    if (expectedCasaId !== null) {
      if (requiredCasaId !== undefined && expectedCasaId !== requiredCasaId) {
        return { ok: false, error: 'SERVER' };
      }
      await setActiveScope(expectedCasaId);
      switchedScope = true;
    }

    while (!session.complete) {
      const requestedCursor = session.cursor;
      const download = await postV2Download(code, requestedCursor, requiredCasaId);
      if (!download.ok) return download;
      if (requestedCursor !== null && download.nextCursor === requestedCursor) {
        return { ok: false, error: 'SERVER' };
      }
      if (expectedCasaId !== null && expectedCasaId !== download.casaId) {
        return { ok: false, error: 'SERVER' };
      }
      if (requiredCasaId !== undefined && requiredCasaId !== download.casaId) {
        return { ok: false, error: 'SERVER' };
      }
      expectedCasaId = download.casaId;
      if (!switchedScope) {
        await setActiveScope(download.casaId);
        switchedScope = true;
      }
      await applySnapshot(download.page);
      session = {
        ...session,
        casaId: download.casaId,
        cursor: download.nextCursor,
        complete: download.nextCursor === null,
      };
      // Fase/cursor vivem no SecureStore global, então sobreviverão à troca do
      // arquivo SQLite e a 429/crash sem repetir upload nem páginas já aplicadas.
      await saveSyncSession(session);
    }

    if (expectedCasaId === null) return { ok: false, error: 'SERVER' };
    const lastSyncAt = new Date().toISOString();
    await setSetting(LAST_SYNC_KEY, lastSyncAt);
    completed = true;
    return { ok: true, casaId: expectedCasaId, lastSyncAt };
  } finally {
    if (!completed && switchedScope && getActiveScope() !== originalScope) {
      await setActiveScope(originalScope);
    }
  }
}

type LegacyPostResult =
  | { ok: true; casaId: number; snapshot: SyncSnapshot }
  | { ok: false; error: PagedSyncError };

function legacyHttpError(response: Response): PagedSyncError | null {
  if (response.status === 404) return 'CASA_NOT_FOUND';
  if (response.status === 409 || response.status === 429) return 'BUSY';
  if (response.status === 413) return 'SYNC_LIMIT';
  return response.ok ? null : 'SERVER';
}

async function postLegacySync(code: string, snapshot: SyncSnapshot): Promise<LegacyPostResult> {
  let response: Response;
  try {
    response = await fetchComTimeout(`${API_BASE_URL}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-casa-code': code,
        'x-repona-sync-protocol': '1',
        'x-repona-client-version': SYNC_V2_CLIENT_VERSION,
        'x-request-id': secureRandomUUID(),
      },
      body: JSON.stringify(snapshot),
    });
  } catch {
    return { ok: false, error: 'NETWORK' };
  }
  const httpError = legacyHttpError(response);
  if (httpError) {
    reportMobileRemoteFailure('sync', response);
    return { ok: false, error: httpError };
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    reportMobileRemoteFailure('sync', response);
    return { ok: false, error: 'SERVER' };
  }
  const parsed = parseLegacySyncResponse(raw);
  if (!parsed) reportMobileRemoteFailure('sync', response);
  return parsed ? { ok: true, ...parsed } : { ok: false, error: 'SERVER' };
}

async function runLegacySync(
  code: string,
  uploadLocal: boolean,
  requiredCasaId?: number,
): Promise<PagedSyncResult> {
  const originalScope = getActiveScope();
  let switchedScope = false;
  let completed = false;
  try {
    // Servidores v1 não conhecem expectedCasaId. Fazemos primeiro um pull
    // vazio: ele autentica e revela casaId sem enviar nenhum dado do SQLite. Só
    // depois da igualdade comprovada montamos/enviamos o snapshot completo.
    if (uploadLocal && requiredCasaId !== undefined) {
      const preflight = await postLegacySync(code, emptySyncSnapshot());
      if (!preflight.ok) return preflight;
      if (preflight.casaId !== requiredCasaId) return { ok: false, error: 'SERVER' };
    }

    const outgoing = uploadLocal ? await buildLocalSnapshot() : emptySyncSnapshot();
    const merged = await postLegacySync(code, outgoing);
    if (!merged.ok) return merged;
    if (requiredCasaId !== undefined && merged.casaId !== requiredCasaId) {
      return { ok: false, error: 'SERVER' };
    }

    await setActiveScope(merged.casaId);
    switchedScope = true;
    await applySnapshot(merged.snapshot);
    const lastSyncAt = new Date().toISOString();
    await setSetting(LAST_SYNC_KEY, lastSyncAt);
    completed = true;
    return { ok: true, casaId: merged.casaId, lastSyncAt };
  } finally {
    if (!completed && switchedScope && getActiveScope() !== originalScope) {
      await setActiveScope(originalScope);
    }
  }
}

async function runPagedSync(
  code: string,
  uploadLocal: boolean,
  requiredCasaId?: number,
): Promise<PagedSyncResult> {
  const v2 = await runV2PagedSync(code, uploadLocal, requiredCasaId);
  if (v2.ok || v2.error !== 'UNSUPPORTED_PROTOCOL') return v2;
  return runLegacySync(code, uploadLocal, requiredCasaId);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}
