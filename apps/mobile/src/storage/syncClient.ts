import * as SecureStore from 'expo-secure-store';
import type { SyncSnapshot } from '@repona/core';
import { API_BASE_URL } from '../config';
import { getSetting, setSetting, deleteSetting } from './settings';
import { buildLocalSnapshot, applySnapshot, parseSyncSnapshot } from './sync';
import { setActiveScope, deleteScopeDatabase } from './database';

const CASA_CODE_KEY = 'casa_code';
// casaId da casa pareada (auditoria #68): determina qual arquivo SQLite abrir, por
// isso mora fora dos arquivos por-casa, no SecureStore junto do token. null =
// não pareado (escopo 'local').
const ACTIVE_CASA_ID_KEY = 'active_casa_id';
const LAST_SYNC_KEY = 'last_sync_at';
// 12 chars = ~60 bits (mesmo formato do servidor, casa.ts CASA_CODE_LEN). (#71)
const CASA_CODE_REGEX = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;

// Snapshot vazio: usado no pareamento para PUXAR os dados da casa sem ENVIAR
// nada do arquivo local ativo — o que impediria dados de outra conta/scratch de
// vazarem para a casa que está sendo pareada. (auditoria #68)
const SNAPSHOT_VAZIO: SyncSnapshot = {
  products: [],
  purchases: [],
  consumptions: [],
  prices: [],
  listItems: [],
};

// O token da casa é a única credencial (sync, login web, exclusão de conta), por
// isso mora no armazenamento seguro do SO (Keychain/Keystore), não no SQLite
// comum — em aparelho comprometido ou backup local, o token não fica legível.
// (auditoria #53)
async function getCasaCodeSeguro(): Promise<string | null> {
  const seguro = await SecureStore.getItemAsync(CASA_CODE_KEY);
  if (seguro !== null) {
    // Se uma migração anterior gravou no SecureStore mas caiu/falhou antes de
    // apagar a cópia legada do SQLite, o early return nunca repetia a limpeza e
    // o token ficava em claro no SQLite indefinidamente. Tenta apagar de novo,
    // best-effort, a cada leitura (DELETE de chave ausente é no-op). (auditoria #53)
    await deleteSetting(CASA_CODE_KEY).catch(() => {});
    return seguro;
  }
  // Migra instalações que guardavam o token no SQLite (versões anteriores):
  // move para o SecureStore e apaga do SQLite, uma vez só.
  const legado = await getSetting(CASA_CODE_KEY);
  if (legado !== null) {
    await SecureStore.setItemAsync(CASA_CODE_KEY, legado);
    await deleteSetting(CASA_CODE_KEY);
    return legado;
  }
  return null;
}

async function setCasaCodeSeguro(code: string): Promise<void> {
  await SecureStore.setItemAsync(CASA_CODE_KEY, code);
}

// casaId ativo no SecureStore (fora dos arquivos por-casa, pois decide qual abrir).
async function setActiveCasaId(casaId: number): Promise<void> {
  await SecureStore.setItemAsync(ACTIVE_CASA_ID_KEY, String(casaId));
}
async function getActiveCasaId(): Promise<number | null> {
  const raw = await SecureStore.getItemAsync(ACTIVE_CASA_ID_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) ? n : null;
}

// Restaura o arquivo SQLite ativo a partir do casaId pareado. Deve rodar no
// arranque do app, ANTES de qualquer leitura de dados, para não ler o scratch
// 'local' quando há uma casa pareada. (auditoria #68)
export async function restoreActiveScope(): Promise<void> {
  const casaId = await getActiveCasaId();
  await setActiveScope(casaId ?? 'local');
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
  | { ok: false; error: 'NOT_PAIRED' | 'INVALID_CODE' | 'NETWORK' | 'CASA_NOT_FOUND' | 'BUSY' | 'SERVER' };

export type DeleteResult =
  | { ok: true }
  | { ok: false; error: 'NOT_PAIRED' | 'NETWORK' | 'CASA_NOT_FOUND' | 'SERVER' };

export async function getCasaCode(): Promise<string | null> {
  return getCasaCodeSeguro();
}

export async function getLastSyncAt(): Promise<string | null> {
  return getSetting(LAST_SYNC_KEY);
}

export async function unpairCasa(): Promise<void> {
  await deleteSetting(CASA_CODE_KEY); // limpa um eventual token legado no arquivo ativo
  await SecureStore.deleteItemAsync(CASA_CODE_KEY);
  await SecureStore.deleteItemAsync(ACTIVE_CASA_ID_KEY);
  // Volta para o escopo local (scratch). O arquivo da casa permanece para uma
  // eventual reconexão; last_sync vive dentro dele, não é global. (auditoria #68)
  await setActiveScope('local');
}

// Envia o snapshot local e aplica o snapshot mesclado que a nuvem devolve.
// O escopo já é o da casa ativa; build e apply operam no arquivo dela.
export async function syncNow(): Promise<SyncResult> {
  const code = await getCasaCode();
  if (!code) return { ok: false, error: 'NOT_PAIRED' };
  let snapshot: SyncSnapshot;
  try {
    // Falha ao montar o snapshot local (SQLite) é local, não de rede. (auditoria #57)
    snapshot = await buildLocalSnapshot();
  } catch {
    return { ok: false, error: 'SERVER' };
  }
  const r = await postSync(code, snapshot);
  if (!r.ok) return { ok: false, error: r.error };
  const at = await adotarCasa(r.casaId, r.merged);
  await setActiveCasaId(r.casaId);
  return { ok: true, lastSyncAt: at };
}

// Nome padrão da conta. O nome é só um rótulo (não é credencial nem tem
// unicidade), então nasce automático para o usuário não precisar decidir nada
// ao ativar o backup — a única coisa que importa é o token que a nuvem devolve.
const NOME_PADRAO = 'Minha casa';

// Cria a conta na nuvem e devolve o token gerado, que fica salvo e é a
// credencial usada para acessar pelo web. Já faz a primeira sincronização.
// Sem parâmetros: o nome é automático (NOME_PADRAO) para o fluxo ser um toque só.
export async function criarConta(): Promise<SyncResult> {
  // Cria a conta e MIGRA os dados locais (scratch) para ela: o snapshot local
  // atual vira o conteúdo inicial da casa nova. É dado do próprio usuário indo
  // para a própria conta nova — não é cruzamento entre casas. (auditoria #68)
  let snapshotLocal: SyncSnapshot;
  try {
    snapshotLocal = await buildLocalSnapshot();
  } catch {
    return { ok: false, error: 'SERVER' };
  }

  let response: Response;
  try {
    response = await fetchComTimeout(`${API_BASE_URL}/api/casa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: NOME_PADRAO }),
    });
  } catch {
    return { ok: false, error: 'NETWORK' };
  }

  if (!response.ok) return { ok: false, error: 'SERVER' };

  const { token } = (await response.json()) as { token: string; casaId: number };
  // Persiste o token ANTES da primeira sincronização (auditoria #58). Ele é a
  // ÚNICA credencial da casa recém-criada e só existe aqui: se a primeira sync
  // falhar (timeout, 413, crash), salvá-lo só no fim perderia a credencial e
  // deixaria a casa órfã na nuvem. Salvo antes, a casa é recuperável e a UI —
  // vendo-se pareada — não reoferece "criar conta", evitando uma segunda casa.
  // O active_casa_id NÃO é gravado ainda: no arranque restoreActiveScope abre o
  // scratch 'local' (não a casa vazia), preservando os dados a enviar; a próxima
  // syncNow empurra o scratch e adota a casa. A idempotência completa do POST
  // (resposta perdida ANTES de recebermos o token) fica para o redesenho (#90).
  await setCasaCodeSeguro(token);
  // Empurra o scratch para a casa nova e adota o merge no arquivo dela.
  const r = await postSync(token, snapshotLocal);
  if (!r.ok) return { ok: false, error: r.error };
  const at = await adotarCasa(r.casaId, r.merged);
  await setActiveCasaId(r.casaId);
  return { ok: true, lastSyncAt: at };
}

// Conecta a uma casa existente PUXANDO os dados dela, sem enviar o arquivo local
// ativo (scratch ou outra casa) — envia snapshot vazio, recebe casaId + dados,
// troca para o arquivo da casa e aplica lá. Nenhum dado cruza de conta. O token
// e o casaId só são persistidos se o pull der certo, para falha de rede/servidor
// não deixar o app "pareado" sem nunca ter sincronizado. (auditoria #68)
export async function pairAndSync(code: string): Promise<SyncResult> {
  const normalized = code.trim().toUpperCase();
  if (!CASA_CODE_REGEX.test(normalized)) return { ok: false, error: 'INVALID_CODE' };

  const r = await postSync(normalized, SNAPSHOT_VAZIO);
  if (!r.ok) return { ok: false, error: r.error };
  const at = await adotarCasa(r.casaId, r.merged);
  await setCasaCodeSeguro(normalized);
  await setActiveCasaId(r.casaId);
  return { ok: true, lastSyncAt: at };
}

// Exclui a conta na nuvem (todos os dados, para todos os aparelhos com este
// token) e desconecta este aparelho. Os dados locais permanecem. (exigência da
// Play: exclusão de conta self-service)
export async function excluirConta(): Promise<DeleteResult> {
  const code = await getCasaCode();
  if (!code) return { ok: false, error: 'NOT_PAIRED' };
  const casaId = await getActiveCasaId();

  let response: Response;
  try {
    response = await fetchComTimeout(`${API_BASE_URL}/api/casa`, {
      method: 'DELETE',
      headers: { 'x-casa-code': code },
    });
  } catch {
    return { ok: false, error: 'NETWORK' };
  }

  if (response.status === 404) return { ok: false, error: 'CASA_NOT_FOUND' };
  if (!response.ok) return { ok: false, error: 'SERVER' };

  await unpairCasa(); // troca para o escopo 'local', fechando o arquivo da casa
  // A conta foi apagada na nuvem: remove o arquivo local da casa para não deixar
  // dados órfãos no aparelho. Feito após unpairCasa (o arquivo já está fechado).
  // (auditoria #68)
  if (casaId !== null) await deleteScopeDatabase(casaId);
  return { ok: true };
}

// POST /api/sync de baixo nível: envia o snapshot dado e devolve casaId + snapshot
// mesclado, SEM aplicar (o caller decide o escopo e aplica no arquivo certo).
type PostSyncResult =
  | { ok: true; casaId: number; merged: SyncSnapshot }
  | { ok: false; error: 'NETWORK' | 'CASA_NOT_FOUND' | 'BUSY' | 'SERVER' };

async function postSync(code: string, snapshot: SyncSnapshot): Promise<PostSyncResult> {
  let response: Response;
  try {
    response = await fetchComTimeout(`${API_BASE_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-casa-code': code },
      body: JSON.stringify(snapshot),
    });
  } catch {
    return { ok: false, error: 'NETWORK' };
  }

  if (response.status === 404) return { ok: false, error: 'CASA_NOT_FOUND' };
  // Outro device da casa está no meio de um merge (lock por casa no servidor);
  // o merge é idempotente — basta tentar de novo. (auditoria 2026-06-09 #1)
  if (response.status === 409) return { ok: false, error: 'BUSY' };
  if (!response.ok) return { ok: false, error: 'SERVER' };

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: 'SERVER' };
  }
  // Valida em runtime antes de aplicar: casaId numérico e snapshot bem-formado.
  // Resposta corrompida/inesperada não deve tocar o SQLite. (auditoria #83)
  const merged = parseSyncSnapshot(data);
  const casaId = isRecord(data) ? data.casaId : undefined;
  if (!merged || typeof casaId !== 'number' || !Number.isInteger(casaId)) {
    return { ok: false, error: 'SERVER' };
  }
  return { ok: true, casaId, merged };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

// Troca para o arquivo da casa e aplica o snapshot mesclado nele, marcando o
// last_sync (que vive dentro do arquivo da casa). A troca de escopo vem ANTES do
// apply para os dados caírem no arquivo certo. (auditoria #68)
async function adotarCasa(casaId: number, merged: SyncSnapshot): Promise<string> {
  await setActiveScope(casaId);
  await applySnapshot(merged);
  const at = new Date().toISOString();
  await setSetting(LAST_SYNC_KEY, at);
  return at;
}
