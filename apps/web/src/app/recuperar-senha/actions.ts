"use server";

import { z } from "zod";
import { solicitarReset } from "@/server/auth/reset";

type Resultado = { ok: true } | { ok: false; error: string };

const emailSchema = z.string().trim().email().max(160);

export async function solicitarResetAction(email: string): Promise<Resultado> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { ok: false, error: "Informe um e-mail válido." };
  try {
    await solicitarReset(parsed.data);
    return { ok: true };
  } catch {
    return { ok: false, error: "Não foi possível enviar agora. Tente novamente." };
  }
}
