"use server";

import { revalidatePath } from "next/cache";
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
};

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
    await entrarComCodigo(id, code);
    revalidarTudo();
    return { ok: true };
  } catch (error) {
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
    await renomearCasa(casaId, name);
    revalidatePath("/perfil");
    return { ok: true };
  } catch (error) {
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
