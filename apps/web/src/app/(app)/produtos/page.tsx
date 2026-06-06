import { requireCasa } from "@/server/auth/session";
import { listProdutos, seedProdutosIniciais } from "@/server/modules/produtos";
import { ProdutosClient } from "./produtos-client";

export default async function ProdutosPage() {
  const { casaId: id } = await requireCasa();
  await seedProdutosIniciais(id);
  const produtos = await listProdutos(id);
  return <ProdutosClient produtos={produtos} />;
}
