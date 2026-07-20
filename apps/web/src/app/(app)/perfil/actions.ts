"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCasa } from "@/server/auth/session";
import { excluirCasa, regenerarCodigo, renomearCasa } from "@/server/modules/casa";

type Resultado = { ok: true } | { ok: false; error: string };

const MENSAGENS: Record<string, string> = {
  NOME_INVALIDO: "Informe um nome para a conta.",
};

const nomeSchema = z.string().trim().min(1).max(80);

function tratar(error: unknown): { ok: false; error: string } {
  const codigo = error instanceof Error ? error.message : "ERRO";
  return { ok: false, error: MENSAGENS[codigo] ?? "Algo deu errado. Tente novamente." };
}

type RotacaoResultado = { ok: true; novoToken: string } | { ok: false; error: string };

export async function regenerarCodigoAction(): Promise<RotacaoResultado> {
  const { casaId } = await requireCasa();
  try {
    const { token } = await regenerarCodigo(casaId);
    // NÃO revalidar /perfil aqui: a sessão atual ainda carrega a
    // credentialVersion antiga e um re-render server-side cairia em requireCasa
    // -> /login (lockout). O cliente reautentica com o novo token (nova sessão)
    // e só então atualiza a tela. (auditoria #13)
    return { ok: true, novoToken: token };
  } catch (error) {
    return tratar(error);
  }
}

export async function excluirContaAction(): Promise<Resultado> {
  const { casaId } = await requireCasa();
  try {
    await excluirCasa(casaId);
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
