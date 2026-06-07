"use server";

import { z } from "zod";
import { redefinirSenha } from "@/server/auth/reset";

type Resultado = { ok: true } | { ok: false; error: string };

const resetSchema = z.object({
  token: z.string().trim().min(10).max(200),
  senha: z.string().min(8).max(200),
});

export async function redefinirSenhaAction(input: {
  token: string;
  senha: string;
}): Promise<Resultado> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "A senha precisa ter ao menos 8 caracteres." };
  try {
    await redefinirSenha(parsed.data.token, parsed.data.senha);
    return { ok: true };
  } catch (error) {
    const codigo = error instanceof Error ? error.message : "ERRO";
    if (codigo === "TOKEN_INVALID") {
      return { ok: false, error: "Link inválido ou expirado. Peça um novo." };
    }
    return { ok: false, error: "Algo deu errado. Tente novamente." };
  }
}
