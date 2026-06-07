import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { obterCasaPorCodigo } from "@/server/modules/casa";
import { mergeCasaSnapshot } from "@/server/modules/sync";

const snapshotSchema = z.object({
  products: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        category: z.string().max(80),
        barcode: z.string().max(120).nullable(),
        photoUri: z.string().max(2000).nullable(),
        purchaseCount: z.number().int().min(0),
        status: z.enum(["active", "missing"]),
        alertThreshold: z.string().max(40).nullable(),
        inventoryQuantity: z.string().max(40),
        inventoryStatus: z.enum(["in_stock", "missing"]),
      })
    )
    .max(2000),
  purchases: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(160),
        quantity: z.string().max(40),
        purchasedAt: z.string().max(40),
      })
    )
    .max(10000),
  consumptions: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(160),
        quantity: z.string().max(40),
        occurredAt: z.string().max(40),
      })
    )
    .max(10000),
});

// Limitador simples por IP (em memória): protege o endpoint público de abuso.
const tentativas = new Map<string, { count: number; resetAt: number }>();
const JANELA_MS = 60 * 1000;
const MAX_POR_JANELA = 30;

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
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const code = req.headers.get("x-casa-code")?.trim().toUpperCase() ?? "";
  const casaId = await obterCasaPorCodigo(code);
  if (!casaId) {
    return NextResponse.json({ error: "CASA_NOT_FOUND" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = snapshotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const merged = await mergeCasaSnapshot(casaId, parsed.data);
  return NextResponse.json(merged);
}
