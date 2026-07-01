import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { criarContaNuvem, excluirCasa, obterCasaPorCodigo } from "@/server/modules/casa";
import { rateLimited, ipDaRequest } from "@/server/rateLimit";

const bodySchema = z.object({
  nome: z.string().trim().min(1).max(80),
});

// Criar conta é evento raro (uma vez por casa). Teto duplo por IP — por hora e
// por dia — para barrar tanto rajada quanto criação pingo-a-pingo que furava o
// limite só-horário antigo. Trade-off de CGNAT: operadoras móveis compartilham
// um IP entre muitos clientes, então o teto diário fica folgado o bastante para
// não bloquear usuários legítimos atrás do mesmo NAT. (auditoria #12)
const CRIAR_JANELA_HORA = 60 * 60;
const CRIAR_MAX_HORA = 5;
const CRIAR_JANELA_DIA = 60 * 60 * 24;
const CRIAR_MAX_DIA = 20;

// Exclusão de conta mantém limite próprio, mais folgado.
const DEL_JANELA_SEG = 60 * 60;
const DEL_MAX_POR_JANELA = 20;

export async function POST(req: NextRequest) {
  const ip = ipDaRequest(req.headers);
  if (
    (await rateLimited(`casa:hora:${ip}`, CRIAR_MAX_HORA, CRIAR_JANELA_HORA)) ||
    (await rateLimited(`casa:dia:${ip}`, CRIAR_MAX_DIA, CRIAR_JANELA_DIA))
  ) {
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
  if (await rateLimited(`casa-del:${ip}`, DEL_MAX_POR_JANELA, DEL_JANELA_SEG)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const code = req.headers.get("x-casa-code")?.trim().toUpperCase() ?? "";
  // Também por token, não só por IP: a exclusão é irreversível e o token no
  // header é o alvo — sem isto, tentativas podiam ser distribuídas por vários
  // IPs sem esbarrar no limite (mesma defesa do login, #20). (auditoria #47)
  if (await rateLimited(`casa-del:token:${code}`, DEL_MAX_POR_JANELA, DEL_JANELA_SEG)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  const casaId = await obterCasaPorCodigo(code);
  if (!casaId) {
    return NextResponse.json({ error: "CASA_NOT_FOUND" }, { status: 404 });
  }

  await excluirCasa(casaId);
  return NextResponse.json({ ok: true });
}
