import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { obterCasaPorCodigo } from "@/server/modules/casa";
import { mergeCasaSnapshot } from "@/server/modules/sync";
import { rateLimited } from "@/server/rateLimit";

const snapshotSchema = z.object({
  products: z
    .array(
      z.object({
        syncId: z.string().uuid().optional(),
        updatedAt: z.string().datetime({ offset: true }).optional(),
        name: z.string().trim().min(1).max(160),
        category: z.string().max(80),
        barcode: z.string().max(120).nullable(),
        purchaseCount: z.number().int().min(0),
        status: z.enum(["active", "missing"]),
        alertThreshold: z.string().max(40).nullable(),
        inventoryQuantity: z.string().max(40),
        inventoryStatus: z.enum(["in_stock", "missing"]),
        // Clientes antigos não enviam archived/occasional: default mantém compat.
        archived: z.boolean().optional().default(false),
        occasional: z.boolean().optional().default(false),
      })
    )
    .max(2000),
  purchases: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(160),
        quantity: z.string().max(40),
        purchasedAt: z.string().datetime({ offset: true }),
      })
    )
    .max(10000),
  consumptions: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(160),
        quantity: z.string().max(40),
        occurredAt: z.string().datetime({ offset: true }),
      })
    )
    .max(10000),
  prices: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(160),
        priceCents: z.number().int().min(1).max(100_000_000),
        recordedAt: z.string().datetime({ offset: true }),
      })
    )
    .max(10000),
  // Itens da lista ativa (auditoria #9). Opcional: clientes antigos não enviam.
  listItems: z
    .array(
      z.object({
        productName: z.string().trim().min(1).max(160),
        quantity: z.string().max(40),
        checked: z.boolean(),
        deleted: z.boolean(),
        updatedAt: z.string().datetime({ offset: true }),
      })
    )
    .max(2000)
    .optional()
    .default([]),
});

// Rate limit por IP via Vercel KV (auditoria #12), com fallback em memória.
const JANELA_SEG = 60;
const MAX_POR_JANELA = 30;

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
  if (await rateLimited(`sync:${ip}`, MAX_POR_JANELA, JANELA_SEG)) {
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
