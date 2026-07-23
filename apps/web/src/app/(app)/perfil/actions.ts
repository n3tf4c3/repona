"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type HouseExportData,
  exportToJSON,
  exportToCSV,
  validateHouseImport,
} from "@repona/core";
import { requireCasa } from "@/server/auth/session";
import { excluirCasa, regenerarToken, renomearCasa } from "@/server/modules/casa";
import { createProduto, listProdutos } from "@/server/modules/produtos";
import { garantirListaAtiva, listarItensAtivos } from "@/server/modules/listas";
import {
  genericActionError,
  reportUnexpectedActionFailure,
} from "@/server/actionFailure";

type Resultado = { ok: true } | { ok: false; error: string };

const MENSAGENS: Record<string, string> = {
  NOME_INVALIDO: "Informe um nome para a conta.",
};

const nomeSchema = z.string().trim().min(1).max(80);

async function tratar(action: string, error: unknown): Promise<{ ok: false; error: string }> {
  const codigo = error instanceof Error ? error.message : "ERRO";
  const mensagem = MENSAGENS[codigo];
  if (mensagem) return { ok: false, error: mensagem };
  const requestId = await reportUnexpectedActionFailure(action);
  return { ok: false, error: genericActionError(requestId) };
}

export async function excluirContaAction(): Promise<Resultado> {
  const { casaId } = await requireCasa();
  try {
    await excluirCasa(casaId);
    return { ok: true };
  } catch (error) {
    return tratar("casa.excluir", error);
  }
}

// Gera um novo token e devolve-o. A rotação invalida a sessão atual (bump de
// credentialVersion), então o cliente usa o token retornado para reautenticar e
// exibir a nova credencial — sem ele a conta ficaria travada.
export async function regenerarTokenAction(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  const { casaId } = await requireCasa();
  try {
    const { token } = await regenerarToken(casaId);
    return { ok: true, token };
  } catch (error) {
    return tratar("casa.regenerar", error);
  }
}

export async function renomearCasaAction(name: string): Promise<Resultado> {
  const { casaId } = await requireCasa();
  try {
    await renomearCasa(casaId, nomeSchema.parse(name));
    revalidatePath("/perfil");
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) return tratar("casa.renomear", new Error("NOME_INVALIDO"));
    return tratar("casa.renomear", error);
  }
}

export async function exportarDadosAction(): Promise<
  { ok: true; json: string; csv: string; filename: string } | { ok: false; error: string }
> {
  const { casaId } = await requireCasa();
  try {
    const casa = await requireCasa();
    const lista = await garantirListaAtiva(casaId);
    const [produtos, itens] = await Promise.all([
      listProdutos(casaId),
      listarItensAtivos(casaId, lista.id),
    ]);

    const exportData: HouseExportData = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      houseName: casa.casaId.toString(),
      products: produtos.map((p) => ({
        name: p.name,
        category: p.category,
        inventoryQuantity: p.inventoryQuantity,
        inventoryStatus: p.inventoryStatus,
        alertThreshold: p.alertThreshold,
        occasional: p.occasional,
        barcode: p.barcode,
      })),
      shoppingListItems: itens.map((i) => ({
        productName: i.productName,
        quantity: i.quantity,
        checked: i.checked,
      })),
    };

    const filename = `repona-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return {
      ok: true,
      json: exportToJSON(exportData),
      csv: exportToCSV(exportData),
      filename,
    };
  } catch (error) {
    return tratar("casa.exportar", error);
  }
}

export async function importarDadosAction(
  jsonContent: string
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { casaId } = await requireCasa();
  try {
    const valid = validateHouseImport(jsonContent);
    if (!valid.ok) {
      return { ok: false, error: valid.error };
    }

    let count = 0;
    for (const p of valid.data.products) {
      try {
        await createProduto(casaId, {
          name: p.name,
          category: p.category ?? "Mercearia",
          alertThreshold: p.alertThreshold ?? null,
          occasional: p.occasional ?? false,
          barcode: p.barcode ?? null,
        });
        count++;
      } catch {
        // Ignora duplicados ou nomes já existentes durante o import em lote
      }
    }

    revalidatePath("/inicio");
    revalidatePath("/lista");
    revalidatePath("/produtos");
    revalidatePath("/perfil");

    return { ok: true, count };
  } catch (error) {
    return tratar("casa.importar", error);
  }
}
