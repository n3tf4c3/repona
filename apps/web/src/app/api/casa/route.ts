import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  criarContaNuvem,
  excluirContaNuvem,
  CASA_CODE_REGEX,
  IDEMPOTENCY_CONFLICT,
  IDEMPOTENCY_RESULT_GONE,
} from "@/server/modules/casa";
import { rateLimited, ipDaRequest } from "@/server/rateLimit";
import { fingerprintToken } from "@/server/rateLimitToken";
import { nextauthOrigin } from "@/server/env";
import { reportUnexpectedRouteFailure } from "@/server/actionFailure";

const bodySchema = z.object({
  nome: z.string().trim().min(1).max(80),
});

const idempotencyKeySchema = z.string().uuid();

function idempotencyKey(req: NextRequest): string | null {
  const parsed = idempotencyKeySchema.safeParse(req.headers.get("idempotency-key")?.trim());
  return parsed.success ? parsed.data.toLowerCase() : null;
}

function errorCode(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

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

// Origem permitida para chamadas de navegador: a própria origem do app
// (NEXTAUTH_URL). O app mobile é fetch nativo e não envia Origin, então não é
// afetado. (auditoria #91)
function origemPermitida(origin: string): boolean {
  const base = nextauthOrigin();
  if (!base) return false;
  try {
    return new URL(origin).origin === base;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  // Bloqueia abuso cross-origin sem preflight: um site externo poderia enviar
  // JSON como text/plain (tipo safelisted, sem preflight) para criar casas. Exige
  // application/json e, quando há Origin (navegador), valida contra a origem do
  // app. O mobile envia application/json e não manda Origin. (auditoria #91)
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "UNSUPPORTED_MEDIA_TYPE" }, { status: 415 });
  }
  const origin = req.headers.get("origin");
  if (origin && !origemPermitida(origin)) {
    return NextResponse.json({ error: "FORBIDDEN_ORIGIN" }, { status: 403 });
  }

  const operationId = idempotencyKey(req);
  if (!operationId) {
    return NextResponse.json({ error: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
  }

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

  try {
    const conta = await criarContaNuvem(parsed.data.nome, operationId);
    return NextResponse.json(conta, { status: 201 });
  } catch (error) {
    const code = errorCode(error);
    if (code === IDEMPOTENCY_CONFLICT) {
      return NextResponse.json({ error: code }, { status: 409 });
    }
    if (code === IDEMPOTENCY_RESULT_GONE) {
      return NextResponse.json({ error: code }, { status: 410 });
    }
    const requestId = reportUnexpectedRouteFailure(
      "conta.criar",
      req.headers.get("x-request-id")
    );
    return NextResponse.json({ error: "SERVER_ERROR", requestId }, { status: 500 });
  }
}

// Exclusão de conta self-service pelo app (exigência da Play). Autenticada pelo
// token da casa no header, como o sync. Apaga a casa e todos os dados.
export async function DELETE(req: NextRequest) {
  const operationId = idempotencyKey(req);
  if (!operationId) {
    return NextResponse.json({ error: "INVALID_IDEMPOTENCY_KEY" }, { status: 400 });
  }

  const ip = ipDaRequest(req.headers);
  if (await rateLimited(`casa-del:${ip}`, DEL_MAX_POR_JANELA, DEL_JANELA_SEG)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const code = req.headers.get("x-casa-code")?.trim().toUpperCase() ?? "";
  // Também por token, não só por IP: a exclusão é irreversível e o token no
  // header é o alvo — sem isto, tentativas podiam ser distribuídas por vários
  // IPs sem esbarrar no limite (mesma defesa do login, #20). (auditoria #47)
  // Só o formato válido vira chave; header arbitrário cai num bucket fixo para
  // não inflar rate_limits. (auditoria #54)
  const tokenKey = CASA_CODE_REGEX.test(code) ? code : "invalido";
  // Fingerprint do token, não o token em claro, na chave persistida. (#43)
  if (
    await rateLimited(
      `casa-del:token:${fingerprintToken(tokenKey, "casa-del")}`,
      DEL_MAX_POR_JANELA,
      DEL_JANELA_SEG
    )
  ) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  try {
    await excluirContaNuvem(code, operationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = errorCode(error);
    if (code === "CASA_NOT_FOUND") {
      return NextResponse.json({ error: code }, { status: 404 });
    }
    if (code === IDEMPOTENCY_CONFLICT) {
      return NextResponse.json({ error: code }, { status: 409 });
    }
    const requestId = reportUnexpectedRouteFailure(
      "conta.excluir",
      req.headers.get("x-request-id")
    );
    return NextResponse.json({ error: "SERVER_ERROR", requestId }, { status: 500 });
  }
}
