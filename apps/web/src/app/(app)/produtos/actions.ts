"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { NewProductInput } from "@repona/core";
import { CATEGORIAS } from "@/lib/categorias";
import { requireCasa } from "@/server/auth/session";
import {
  createProduto,
  updateProduto,
  excluirOuArquivarProduto,
  desarquivarProduto,
} from "@/server/modules/produtos";
import { definirQuantidade, marcarEmFalta, consumir } from "@/server/modules/estoque";
import { adicionarProduto } from "@/server/modules/listas";

type Resultado = { ok: true; arquivado?: boolean } | { ok: false; error: string };

const MENSAGENS: Record<string, string> = {
  PRODUCT_NAME_REQUIRED: "Informe o nome do produto.",
  PRODUCT_ALREADY_EXISTS: "Já existe um produto com esse nome.",
  PRODUCT_HAS_HISTORY: "Não dá para excluir: este produto tem histórico de compras.",
  PRODUCT_NOT_FOUND: "Produto não encontrado.",
  INVENTORY_ALREADY_MISSING: "Este produto já está em falta.",
  INPUT_INVALID: "Dados inválidos. Confira as informações e tente novamente.",
};

const idSchema = z.number().int().positive();
const quantitySchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^\d+(?:[.,]\d+)?\s*[A-Za-zÀ-ÿ]+$/);
const productInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z
    .string()
    .trim()
    .transform((value) => value || "Mercearia")
    .pipe(z.enum(CATEGORIAS)),
  barcode: z.string().trim().max(80).nullable().optional().transform((value) => value || null),
  photoUri: z.string().trim().max(1000).nullable().optional().transform((value) => value || null),
  alertThreshold: z.string().trim().max(30).nullable().optional().transform((value) => value || null),
  occasional: z.boolean().optional().default(false),
});

function tratar(error: unknown): Resultado {
  const codigo = error instanceof Error ? error.message : "ERRO";
  return { ok: false, error: MENSAGENS[codigo] ?? "Algo deu errado. Tente novamente." };
}

function validar<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("INPUT_INVALID");
  return parsed.data;
}

function revalidarDominio() {
  for (const path of ["/inicio", "/produtos", "/lista", "/historico"]) {
    revalidatePath(path);
  }
}

export async function criarProdutoAction(input: NewProductInput): Promise<Resultado> {
  const { casaId: id } = await requireCasa();
  try {
    await createProduto(id, validar(productInputSchema, input));
    revalidarDominio();
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function atualizarProdutoAction(
  produtoId: number,
  input: NewProductInput
): Promise<Resultado> {
  const { casaId: id } = await requireCasa();
  try {
    await updateProduto(id, validar(idSchema, produtoId), validar(productInputSchema, input));
    revalidarDominio();
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function excluirProdutoAction(produtoId: number): Promise<Resultado> {
  const { casaId: id } = await requireCasa();
  try {
    const { arquivado } = await excluirOuArquivarProduto(id, validar(idSchema, produtoId));
    revalidarDominio();
    return { ok: true, arquivado };
  } catch (error) {
    return tratar(error);
  }
}

export async function desarquivarProdutoAction(produtoId: number): Promise<Resultado> {
  const { casaId: id } = await requireCasa();
  try {
    await desarquivarProduto(id, validar(idSchema, produtoId));
    revalidarDominio();
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function definirQuantidadeAction(
  produtoId: number,
  quantity: string
): Promise<Resultado> {
  const { casaId: id } = await requireCasa();
  try {
    await definirQuantidade(id, validar(idSchema, produtoId), validar(quantitySchema, quantity));
    revalidarDominio();
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function marcarEmFaltaAction(produtoId: number): Promise<Resultado> {
  const { casaId: id } = await requireCasa();
  try {
    await marcarEmFalta(id, validar(idSchema, produtoId));
    revalidarDominio();
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function consumirAction(produtoId: number): Promise<Resultado> {
  const { casaId: id } = await requireCasa();
  try {
    await consumir(id, validar(idSchema, produtoId));
    revalidarDominio();
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}

export async function adicionarAListaAction(produtoId: number): Promise<Resultado> {
  const { casaId: id } = await requireCasa();
  try {
    await adicionarProduto(id, validar(idSchema, produtoId));
    revalidarDominio();
    return { ok: true };
  } catch (error) {
    return tratar(error);
  }
}
