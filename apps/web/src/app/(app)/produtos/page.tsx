import { requireCasa } from "@/server/auth/session";
import { listProdutos, listProdutosArquivados } from "@/server/modules/produtos";
import { ProdutosClient } from "./produtos-client";

export default async function ProdutosPage() {
  const { casaId: id } = await requireCasa();
  const [produtos, arquivados] = await Promise.all([listProdutos(id), listProdutosArquivados(id)]);
  return <ProdutosClient produtos={produtos} arquivados={arquivados} />;
}
