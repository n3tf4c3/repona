"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import {
  alternarItem,
  atualizarQuantidade,
  removerItem,
  finalizarCompra,
} from "@/server/modules/listas";

type Resultado = { ok: true } | { ok: false; error: string };

function tratar(): Resultado {
  return { ok: false, error: "Algo deu errado. Tente novamente." };
}

export async function alternarItemAction(itemId: number): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await alternarItem(id, itemId);
    revalidatePath("/lista");
    return { ok: true };
  } catch {
    return tratar();
  }
}

export async function atualizarQuantidadeAction(
  itemId: number,
  quantity: string
): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await atualizarQuantidade(id, itemId, quantity);
    revalidatePath("/lista");
    return { ok: true };
  } catch {
    return tratar();
  }
}

export async function removerItemAction(itemId: number): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await removerItem(id, itemId);
    revalidatePath("/lista");
    return { ok: true };
  } catch {
    return tratar();
  }
}

export async function finalizarCompraAction(): Promise<
  { ok: true; total: number } | { ok: false; error: string }
> {
  const { id } = await requireUser();
  try {
    const total = await finalizarCompra(id);
    revalidatePath("/lista");
    revalidatePath("/produtos");
    return { ok: true, total };
  } catch {
    return { ok: false, error: "Não foi possível finalizar a compra." };
  }
}
