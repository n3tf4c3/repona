import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { criarContaNuvem } from "@/server/modules/casa";

const bodySchema = z.object({
  nome: z.string().trim().min(1).max(80),
});

// Limitador simples por IP (em memória): evita criação em massa de contas.
// LIMITAÇÃO CONHECIDA (auditoria #12): contador em memória + chave x-forwarded-for
// não dão limite global em serverless/multi-instância. Aceito por ora; limite real
// exige store externo (Vercel KV/Upstash) e IP de fonte confiável do provedor.
const tentativas = new Map<string, { count: number; resetAt: number }>();
const JANELA_MS = 60 * 60 * 1000;
const MAX_POR_JANELA = 20;

function rateLimited(ip: string): boolean {
  const agora = Date.now();
  const t = tentativas.get(ip);
  if (!t || t.resetAt <= agora) {
    tentativas.set(ip, { count: 1, resetAt: agora + JANELA_MS });
    return false;
  }
  t.count += 1;
  return t.count > MAX_POR_JANELA;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
  if (rateLimited(ip)) {
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
