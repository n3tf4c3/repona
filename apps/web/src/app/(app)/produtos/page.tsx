import { requireCasa } from "@/server/auth/session";
import { listarPrecosPorProduto } from "@/server/modules/historico";
import { listProdutos, listProdutosArquivados } from "@/server/modules/produtos";
import { ProdutosClient } from "./produtos-client";

export default async function ProdutosPage() {
  const { casaId: id } = await requireCasa();
  const [produtos, arquivados, precos] = await Promise.all([
    listProdutos(id),
    listProdutosArquivados(id),
    listarPrecosPorProduto(id),
  ]);
  return <ProdutosClient produtos={produtos} arquivados={arquivados} precos={precos} />;
}
