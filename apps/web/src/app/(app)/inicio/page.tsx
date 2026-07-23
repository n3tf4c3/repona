import { buildInventoryAlerts, buildRebuySuggestionsList } from "@repona/core";
import { requireCasa } from "@/server/auth/session";
import { listProdutos } from "@/server/modules/produtos";
import { garantirListaAtiva, listarItensAtivos } from "@/server/modules/listas";
import { InicioClient } from "./inicio-client";

export default async function InicioPage() {
  const { casaId: id } = await requireCasa();

  const lista = await garantirListaAtiva(id);
  const [produtos, itens] = await Promise.all([listProdutos(id), listarItensAtivos(id, lista.id)]);

  const listedIds = itens.map((i) => i.productId);
  const listedSet = new Set(listedIds);
  const alertas = buildInventoryAlerts(produtos);
  const sugestoes = buildRebuySuggestionsList(produtos, listedIds, 6);
  const costuma = produtos
    .filter((p) => !listedSet.has(p.id))
    .sort((a, b) => b.purchaseCount - a.purchaseCount)
    .slice(0, 6);

  const comprados = itens.filter((i) => i.checked).length;

  return (
    <InicioClient
      listName={lista.name}
      total={itens.length}
      comprados={comprados}
      alertas={alertas}
      sugestoes={sugestoes}
      costuma={costuma}
    />
  );
}
