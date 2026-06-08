import "server-only";
import { randomInt } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { casas } from "@/server/db/schema";

export type CasaDTO = {
  id: number;
  name: string;
  inviteCode: string;
};

// Código de acesso (token): 8 chars base32 sem caracteres ambíguos (0/O/1/I).
// É a única credencial — nasce no mobile e é usado para entrar no web.
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function gerarCodigo(): string {
  let codigo = "";
  for (let i = 0; i < 8; i++) {
    codigo += ALFABETO[randomInt(ALFABETO.length)];
  }
  return codigo;
}

async function criarCasa(name: string): Promise<{ id: number; code: string }> {
  // Tenta algumas vezes em caso de colisão do código único.
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const code = gerarCodigo();
    try {
      const [casa] = await db
        .insert(casas)
        .values({ name, inviteCode: code })
        .returning({ id: casas.id });
      return { id: casa.id, code };
    } catch (error) {
      if (tentativa === 4) throw error;
    }
  }
  throw new Error("CASA_CREATE_FAILED");
}

// Cria a conta (= casa) com o nome escolhido no mobile e devolve o token.
export async function criarContaNuvem(nome: string): Promise<{ token: string; name: string }> {
  const name = nome.trim();
  if (!name) throw new Error("NOME_INVALIDO");
  const { code } = await criarCasa(name);
  return { token: code, name };
}

// Resolve a casa pelo token. Usado pela sincronização do mobile.
export async function obterCasaPorCodigo(code: string): Promise<number | null> {
  const codigo = code.trim().toUpperCase();
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(codigo)) return null;
  const [casa] = await db
    .select({ id: casas.id })
    .from(casas)
    .where(eq(casas.inviteCode, codigo))
    .limit(1);
  return casa?.id ?? null;
}

// Autentica no web pelo token: devolve id + nome + versão da credencial, ou null.
export async function autenticarCasa(
  code: string
): Promise<{ id: number; name: string; credentialVersion: number } | null> {
  const codigo = code.trim().toUpperCase();
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(codigo)) return null;
  const [casa] = await db
    .select({ id: casas.id, name: casas.name, credentialVersion: casas.credentialVersion })
    .from(casas)
    .where(eq(casas.inviteCode, codigo))
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
    .select({ id: casas.id, name: casas.name, inviteCode: casas.inviteCode })
    .from(casas)
    .where(eq(casas.id, casaId))
    .limit(1);
  if (!casa) throw new Error("CASA_NOT_FOUND");
  return casa;
}

export async function regenerarCodigo(casaId: number): Promise<void> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      // Incrementa a versão da credencial junto com o novo código: invalida o
      // token antigo (logins/syncs) e as sessões web já emitidas. (auditoria #13)
      await db
        .update(casas)
        .set({
          inviteCode: gerarCodigo(),
          credentialVersion: sql`${casas.credentialVersion} + 1`,
        })
        .where(eq(casas.id, casaId));
      return;
    } catch (error) {
      if (tentativa === 4) throw error;
    }
  }
}

export async function renomearCasa(casaId: number, name: string): Promise<void> {
  const nome = name.trim();
  if (!nome) throw new Error("NOME_INVALIDO");
  await db.update(casas).set({ name: nome }).where(eq(casas.id, casaId));
}
