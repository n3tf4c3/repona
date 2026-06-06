"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser, requireCasa } from "@/server/auth/session";
import {
  entrarComCodigo,
  regenerarCodigo,
  renomearCasa,
  sairDaCasa,
} from "@/server/modules/casa";

type Resultado = { ok: true } | { ok: false; error: string };

const MENSAGENS: Record<string, string> = {
  CODIGO_INVALIDO: "Código inválido. Confira e tente de novo.",
  NOME_INVALIDO: "Informe um nome para a casa.",
  INPUT_INVALID: "Dados inválidos. Confira as informações e tente novamente.",
  TOO_MANY_ATTEMPTS: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
};

const codigoSchema = z.string().trim().toUpperCase().regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
const nomeSchema = z.string().trim().min(1).max(80);

function tratar(error: unknown): Resultado {
  const codigo = error instanceof Error ? error.message : "ERRO";
  return { ok: false, error: MENSAGENS[codigo] ?? "Algo deu errado. Tente novamente." };
}

// Trocar de casa (entrar/sair) muda todos os dados de domínio: revalida tudo.
function revalidarTudo() {
  for (const p of ["/inicio", "/produtos", "/lista", "/historico", "/perfil"]) {
    revalidatePath(p);
  }
}

export async function entrarComCodigoAction(code: string): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await entrarComCodigo(id, codigoSchema.parse(code));
    revalidarTudo();
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) return tratar(new Error("CODIGO_INVALIDO"));
    return tratar(error);
  }
}

export async function regenerarCodigoAction(): Promise<Resultado> {
  const { casaId } = await requireCasa();
  try {
    await regenerarCodigo(casaId);
    revalidatePath("/perfil");
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function renomearCasaAction(name: string): Promise<Resultado> {
  const { casaId } = await requireCasa();
  try {
    await renomearCasa(casaId, nomeSchema.parse(name));
    revalidatePath("/perfil");
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) return tratar(new Error("NOME_INVALIDO"));
    return tratar(error);
  }
}

export async function sairDaCasaAction(): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await sairDaCasa(id);
    revalidarTudo();
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}
