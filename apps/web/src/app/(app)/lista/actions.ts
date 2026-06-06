"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isEmptyQuantity } from "@repona/core";
import { requireCasa } from "@/server/auth/session";
import {
  alternarItem,
  atualizarQuantidade,
  removerItem,
  finalizarCompra,
} from "@/server/modules/listas";

type Resultado = { ok: true } | { ok: false; error: string };

const idSchema = z.number().int().positive();
const quantitySchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^\d+(?:[.,]\d+)?\s*[A-Za-zÀ-ÿ]+$/)
  .refine((value) => !isEmptyQuantity(value));

function tratar(error?: unknown): Resultado {
  if (error instanceof Error && error.message === "QUANTITY_INVALID") {
    return { ok: false, error: "A quantidade precisa ser maior que zero." };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, error: "Dados inválidos. Confira as informações e tente novamente." };
  }
  return { ok: false, error: "Algo deu errado. Tente novamente." };
}

function revalidarLista() {
  for (const path of ["/inicio", "/lista", "/produtos", "/historico"]) {
    revalidatePath(path);
  }
}

export async function alternarItemAction(itemId: number): Promise<Resultado> {
  const { casaId: id } = await requireCasa();
  try {
    await alternarItem(id, idSchema.parse(itemId));
    revalidarLista();
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function atualizarQuantidadeAction(
  itemId: number,
  quantity: string
): Promise<Resultado> {
  const { casaId: id } = await requireCasa();
  try {
    await atualizarQuantidade(id, idSchema.parse(itemId), quantitySchema.parse(quantity));
    revalidarLista();
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function removerItemAction(itemId: number): Promise<Resultado> {
  const { casaId: id } = await requireCasa();
  try {
    await removerItem(id, idSchema.parse(itemId));
    revalidarLista();
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function finalizarCompraAction(): Promise<
  { ok: true; total: number } | { ok: false; error: string }
> {
  const { casaId: id } = await requireCasa();
  try {
    const total = await finalizarCompra(id);
    revalidarLista();
    return { ok: true, total };
  } catch (error) {
    if (error instanceof Error && error.message === "QUANTITY_INVALID") {
      return { ok: false, error: "A compra tem item com quantidade zerada." };
    }
    return { ok: false, error: "Não foi possível finalizar a compra." };
  }
}
