import * as SecureStore from 'expo-secure-store';
import type { SyncSnapshot } from '@repona/core';
import { API_BASE_URL } from '../config';
import { getSetting, setSetting, deleteSetting } from './settings';
import { buildLocalSnapshot, applySnapshot } from './sync';

const CASA_CODE_KEY = 'casa_code';
const LAST_SYNC_KEY = 'last_sync_at';
const CASA_CODE_REGEX = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;

// O token da casa é a única credencial (sync, login web, exclusão de conta), por
// isso mora no armazenamento seguro do SO (Keychain/Keystore), não no SQLite
// comum — em aparelho comprometido ou backup local, o token não fica legível.
// (auditoria #53)
async function getCasaCodeSeguro(): Promise<string | null> {
  const seguro = await SecureStore.getItemAsync(CASA_CODE_KEY);
  if (seguro !== null) return seguro;
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

export type SyncResult =
  | { ok: true; lastSyncAt: string }
  | { ok: false; error: 'NOT_PAIRED' | 'INVALID_CODE' | 'INVALID_NAME' | 'NETWORK' | 'CASA_NOT_FOUND' | 'BUSY' | 'SERVER' };

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
  await SecureStore.deleteItemAsync(CASA_CODE_KEY);
  await deleteSetting(CASA_CODE_KEY); // limpa também um eventual token legado no SQLite
  await deleteSetting(LAST_SYNC_KEY);
}

// Envia o snapshot local e aplica o snapshot mesclado que a nuvem devolve.
export async function syncNow(): Promise<SyncResult> {
  const code = await getCasaCode();
  if (!code) return { ok: false, error: 'NOT_PAIRED' };
  return enviarSnapshot(code);
}

// Cria a conta na nuvem (nome + token). O token gerado fica salvo e é a
// credencial usada para acessar pelo web. Já faz a primeira sincronização.
export async function criarConta(nome: string): Promise<SyncResult> {
  const n = nome.trim();
  if (!n) return { ok: false, error: 'INVALID_NAME' };

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/casa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: n }),
    });
  } catch {
    return { ok: false, error: 'NETWORK' };
  }

  if (!response.ok) return { ok: false, error: 'SERVER' };

  const { token } = (await response.json()) as { token: string };
  await setCasaCodeSeguro(token);
  return enviarSnapshot(token);
}

// Define o código da casa e faz a primeira sincronização. O código só é
// persistido se o primeiro sync der certo — assim falha de rede/servidor não
// deixa o app "pareado" com um código que nunca sincronizou.
export async function pairAndSync(code: string): Promise<SyncResult> {
  const normalized = code.trim().toUpperCase();
  if (!CASA_CODE_REGEX.test(normalized)) return { ok: false, error: 'INVALID_CODE' };

  const result = await enviarSnapshot(normalized);
  if (result.ok) {
    await setCasaCodeSeguro(normalized);
  }
  return result;
}

// Exclui a conta na nuvem (todos os dados, para todos os aparelhos com este
// token) e desconecta este aparelho. Os dados locais permanecem. (exigência da
// Play: exclusão de conta self-service)
export async function excluirConta(): Promise<DeleteResult> {
  const code = await getCasaCode();
  if (!code) return { ok: false, error: 'NOT_PAIRED' };

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/casa`, {
      method: 'DELETE',
      headers: { 'x-casa-code': code },
    });
  } catch {
    return { ok: false, error: 'NETWORK' };
  }

  if (response.status === 404) return { ok: false, error: 'CASA_NOT_FOUND' };
  if (!response.ok) return { ok: false, error: 'SERVER' };

  await unpairCasa();
  return { ok: true };
}

async function enviarSnapshot(code: string): Promise<SyncResult> {
  // Falha ao montar o snapshot local (SQLite) é local, não de rede. (auditoria #57)
  let snapshot: SyncSnapshot;
  try {
    snapshot = await buildLocalSnapshot();
  } catch {
    return { ok: false, error: 'SERVER' };
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/sync`, {
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

  // JSON inesperado ou falha ao aplicar o snapshot no SQLite não devem escapar
  // como exceção não tratada e deixar a UI travada. (auditoria #57)
  try {
    const merged = (await response.json()) as SyncSnapshot;
    await applySnapshot(merged);
  } catch {
    return { ok: false, error: 'SERVER' };
  }

  const at = new Date().toISOString();
  await setSetting(LAST_SYNC_KEY, at);
  return { ok: true, lastSyncAt: at };
}
