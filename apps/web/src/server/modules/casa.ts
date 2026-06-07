import "server-only";
import { randomInt } from "crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { casas, usuarios } from "@/server/db/schema";

export type Membro = { id: number; nome: string | null; email: string };
export type CasaDTO = {
  id: number;
  name: string;
  inviteCode: string;
  membros: Membro[];
};

// Código de convite: 8 chars base32 sem caracteres ambíguos (0/O/1/I).
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const tentativasConvite = new Map<number, { count: number; resetAt: number }>();
const JANELA_TENTATIVAS_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS_CONVITE = 10;

function gerarCodigo(): string {
  let codigo = "";
  for (let i = 0; i < 8; i++) {
    codigo += ALFABETO[randomInt(ALFABETO.length)];
  }
  return codigo;
}

function validarTentativasConvite(userId: number) {
  const agora = Date.now();
  const tentativa = tentativasConvite.get(userId);
  if (!tentativa || tentativa.resetAt <= agora) return;
  if (tentativa.count >= MAX_TENTATIVAS_CONVITE) throw new Error("TOO_MANY_ATTEMPTS");
}

function registrarTentativaConvite(userId: number) {
  const agora = Date.now();
  const tentativa = tentativasConvite.get(userId);
  if (!tentativa || tentativa.resetAt <= agora) {
    tentativasConvite.set(userId, { count: 1, resetAt: agora + JANELA_TENTATIVAS_MS });
    return;
  }
  tentativasConvite.set(userId, { ...tentativa, count: tentativa.count + 1 });
}

export async function criarCasa(name = "Minha casa"): Promise<number> {
  // Tenta algumas vezes em caso de colisão do código único.
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      const [casa] = await db
        .insert(casas)
        .values({ name, inviteCode: gerarCodigo() })
        .returning({ id: casas.id });
      return casa.id;
    } catch (error) {
      if (tentativa === 4) throw error;
    }
  }
  throw new Error("CASA_CREATE_FAILED");
}

// Garante que o usuário tem uma casa; cria e vincula se necessário. Retorna casaId.
export async function garantirCasa(userId: number): Promise<number> {
  const [usuario] = await db
    .select({ id: usuarios.id, casaId: usuarios.casaId })
    .from(usuarios)
    .where(eq(usuarios.id, userId))
    .limit(1);

  if (!usuario) throw new Error("USER_NOT_FOUND");
  if (usuario.casaId) return usuario.casaId;

  const casaId = await criarCasa();
  await db.update(usuarios).set({ casaId }).where(eq(usuarios.id, userId));
  return casaId;
}

// Resolve a casa pelo código de convite. Usado pela sincronização do mobile,
// onde o código é a própria credencial (sem login/senha).
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

export async function obterCasa(userId: number): Promise<CasaDTO> {
  const casaId = await garantirCasa(userId);
  const [casa] = await db
    .select({ id: casas.id, name: casas.name, inviteCode: casas.inviteCode })
    .from(casas)
    .where(eq(casas.id, casaId))
    .limit(1);

  const membros = await db
    .select({ id: usuarios.id, nome: usuarios.nome, email: usuarios.email })
    .from(usuarios)
    .where(eq(usuarios.casaId, casaId))
    .orderBy(asc(usuarios.id));

  return { id: casa.id, name: casa.name, inviteCode: casa.inviteCode, membros };
}

export async function entrarComCodigo(userId: number, code: string): Promise<void> {
  validarTentativasConvite(userId);
  const codigo = code.trim().toUpperCase();
  if (!codigo) throw new Error("CODIGO_INVALIDO");

  const [casa] = await db
    .select({ id: casas.id })
    .from(casas)
    .where(eq(casas.inviteCode, codigo))
    .limit(1);
  if (!casa) {
    registrarTentativaConvite(userId);
    throw new Error("CODIGO_INVALIDO");
  }

  await db.update(usuarios).set({ casaId: casa.id }).where(eq(usuarios.id, userId));
  tentativasConvite.delete(userId);
}

export async function regenerarCodigo(casaId: number): Promise<void> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      await db.update(casas).set({ inviteCode: gerarCodigo() }).where(eq(casas.id, casaId));
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

// Sair: cria uma casa nova e vazia e move o usuário para ela.
export async function sairDaCasa(userId: number): Promise<void> {
  const casaId = await criarCasa();
  await db.update(usuarios).set({ casaId }).where(eq(usuarios.id, userId));
}
