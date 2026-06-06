"use server";

import { revalidatePath } from "next/cache";
import type { NewProductInput } from "@repona/core";
import { requireUser } from "@/server/auth/session";
import {
  createProduto,
  updateProduto,
  deleteProduto,
} from "@/server/modules/produtos";
import { definirQuantidade, marcarEmFalta, consumir } from "@/server/modules/estoque";
import { adicionarProduto } from "@/server/modules/listas";

type Resultado = { ok: true } | { ok: false; error: string };

const MENSAGENS: Record<string, string> = {
  PRODUCT_NAME_REQUIRED: "Informe o nome do produto.",
  PRODUCT_ALREADY_EXISTS: "Já existe um produto com esse nome.",
  PRODUCT_HAS_HISTORY: "Não dá para excluir: este produto tem histórico de compras.",
  PRODUCT_NOT_FOUND: "Produto não encontrado.",
  INVENTORY_ALREADY_MISSING: "Este produto já está em falta.",
};

function tratar(error: unknown): Resultado {
  const codigo = error instanceof Error ? error.message : "ERRO";
  return { ok: false, error: MENSAGENS[codigo] ?? "Algo deu errado. Tente novamente." };
}

export async function criarProdutoAction(input: NewProductInput): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await createProduto(id, input);
    revalidatePath("/produtos");
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function atualizarProdutoAction(
  produtoId: number,
  input: NewProductInput
): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await updateProduto(id, produtoId, input);
    revalidatePath("/produtos");
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function excluirProdutoAction(produtoId: number): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await deleteProduto(id, produtoId);
    revalidatePath("/produtos");
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function definirQuantidadeAction(
  produtoId: number,
  quantity: string
): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await definirQuantidade(id, produtoId, quantity);
    revalidatePath("/produtos");
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function marcarEmFaltaAction(produtoId: number): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await marcarEmFalta(id, produtoId);
    revalidatePath("/produtos");
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function consumirAction(produtoId: number): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await consumir(id, produtoId);
    revalidatePath("/produtos");
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function adicionarAListaAction(produtoId: number): Promise<Resultado> {
  const { id } = await requireUser();
  try {
    await adicionarProduto(id, produtoId);
    revalidatePath("/lista");
    revalidatePath("/produtos");
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}
