import { requireUser } from "@/server/auth/session";
import { garantirListaAtiva, listarItensAtivos } from "@/server/modules/listas";
import { agruparPorCategoria } from "@/lib/categorias";
import { ListaClient } from "./lista-client";

export default async function ListaPage() {
  const { id } = await requireUser();
  const lista = await garantirListaAtiva(id);
  const itens = await listarItensAtivos(id);
  const grupos = agruparPorCategoria(itens);
  return <ListaClient listName={lista.name} grupos={grupos} total={itens.length} />;
}
