"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCasa } from "@/server/auth/session";
import { excluirCasa, regenerarToken, renomearCasa } from "@/server/modules/casa";
import {
  genericActionError,
  reportUnexpectedActionFailure,
} from "@/server/actionFailure";

type Resultado = { ok: true } | { ok: false; error: string };

const MENSAGENS: Record<string, string> = {
  NOME_INVALIDO: "Informe um nome para a conta.",
};

const nomeSchema = z.string().trim().min(1).max(80);

async function tratar(action: string, error: unknown): Promise<{ ok: false; error: string }> {
  const codigo = error instanceof Error ? error.message : "ERRO";
  const mensagem = MENSAGENS[codigo];
  if (mensagem) return { ok: false, error: mensagem };
  const requestId = await reportUnexpectedActionFailure(action);
  return { ok: false, error: genericActionError(requestId) };
}

export async function excluirContaAction(): Promise<Resultado> {
  const { casaId } = await requireCasa();
  try {
    await excluirCasa(casaId);
    return { ok: true };
  } catch (error) {
    return tratar("casa.excluir", error);
  }
}

// Gera um novo token e devolve-o. A rotação invalida a sessão atual (bump de
// credentialVersion), então o cliente usa o token retornado para reautenticar e
// exibir a nova credencial — sem ele a conta ficaria travada.
export async function regenerarTokenAction(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  const { casaId } = await requireCasa();
  try {
    const { token } = await regenerarToken(casaId);
    return { ok: true, token };
  } catch (error) {
    return tratar("casa.regenerar", error);
  }
}

export async function renomearCasaAction(name: string): Promise<Resultado> {
  const { casaId } = await requireCasa();
  try {
    await renomearCasa(casaId, nomeSchema.parse(name));
    revalidatePath("/perfil");
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) return tratar("casa.renomear", new Error("NOME_INVALIDO"));
    return tratar("casa.renomear", error);
  }
}
