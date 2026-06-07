"use server";

import { z } from "zod";
import { registrarUsuario } from "@/server/auth/register";

type Resultado = { ok: true } | { ok: false; error: string };

const cadastroSchema = z.object({
  nome: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(160),
  senha: z.string().min(8).max(200),
});

const MENSAGENS: Record<string, string> = {
  EMAIL_EXISTS: "Este e-mail já está cadastrado. Tente entrar.",
  INPUT_INVALID: "Confira os dados: e-mail válido e senha de ao menos 8 caracteres.",
};

export async function cadastrarAction(input: {
  nome?: string;
  email: string;
  senha: string;
}): Promise<Resultado> {
  const parsed = cadastroSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: MENSAGENS.INPUT_INVALID };

  try {
    await registrarUsuario({
      nome: parsed.data.nome ?? "",
      email: parsed.data.email,
      senha: parsed.data.senha,
    });
    return { ok: true };
  } catch (error) {
    const codigo = error instanceof Error ? error.message : "ERRO";
    return { ok: false, error: MENSAGENS[codigo] ?? "Algo deu errado. Tente novamente." };
  }
}
