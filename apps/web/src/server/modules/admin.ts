import "server-only";
import { desc, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { casas } from "@/server/db/schema";

// Listagem das casas para o painel admin. Dá visibilidade sobre quem foi criado
// e ajuda a identificar contas vazias (criação ilimitada de tokens deixa casas
// órfãs no banco). O token NÃO é exposto aqui (auditoria #38: a credencial é
// mascarada fora do CLI com --show-token); o painel mostra só nome, criação e
// contadores. Contadores via subquery escalar para não inflar por join.
export type CasaAdminDTO = {
  id: number;
  name: string;
  createdAt: Date;
  produtos: number;
  compras: number;
};

export async function listarCasas(): Promise<CasaAdminDTO[]> {
  return db
    .select({
      id: casas.id,
      name: casas.name,
      createdAt: casas.createdAt,
      produtos: sql<number>`(select count(*) from products where casa_id = ${casas.id})::int`,
      compras: sql<number>`(select count(*) from purchase_history where casa_id = ${casas.id})::int`,
    })
    .from(casas)
    .orderBy(desc(casas.createdAt));
}
