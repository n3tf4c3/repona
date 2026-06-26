import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { criarContaNuvem, excluirCasa, obterCasaPorCodigo } from "@/server/modules/casa";
import { rateLimited, ipDaRequest } from "@/server/rateLimit";

const bodySchema = z.object({
  nome: z.string().trim().min(1).max(80),
});

// Rate limit por IP via Vercel KV (auditoria #12), com fallback em memória.
const JANELA_SEG = 60 * 60;
const MAX_POR_JANELA = 20;

export async function POST(req: NextRequest) {
  const ip = ipDaRequest(req.headers);
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

// Exclusão de conta self-service pelo app (exigência da Play). Autenticada pelo
// token da casa no header, como o sync. Apaga a casa e todos os dados.
export async function DELETE(req: NextRequest) {
  const ip = ipDaRequest(req.headers);
  if (await rateLimited(`casa-del:${ip}`, MAX_POR_JANELA, JANELA_SEG)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const code = req.headers.get("x-casa-code")?.trim().toUpperCase() ?? "";
  const casaId = await obterCasaPorCodigo(code);
  if (!casaId) {
    return NextResponse.json({ error: "CASA_NOT_FOUND" }, { status: 404 });
  }

  await excluirCasa(casaId);
  return NextResponse.json({ ok: true });
}
