import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { criarContaNuvem } from "@/server/modules/casa";
import { rateLimited } from "@/server/rateLimit";

const bodySchema = z.object({
  nome: z.string().trim().min(1).max(80),
});

// Rate limit por IP via Vercel KV (auditoria #12), com fallback em memória.
const JANELA_SEG = 60 * 60;
const MAX_POR_JANELA = 20;

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
  if (await rateLimited(`casa:${ip}`, MAX_POR_JANELA, JANELA_SEG)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const conta = await criarContaNuvem(parsed.data.nome);
  return NextResponse.json(conta, { status: 201 });
}
