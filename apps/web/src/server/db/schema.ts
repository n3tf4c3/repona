import { pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Schema inicial mínimo: apenas o necessário para o login (NextAuth) do esqueleto.
// As tabelas de domínio (produtos, listas, estoque, histórico) serão adicionadas
// na etapa de portar as funcionalidades do app.
export const usuarios = pgTable(
  "usuarios",
  {
    id: serial("id").primaryKey(),
    nome: text("nome"),
    email: text("email").notNull(),
    senhaHash: text("senha_hash").notNull(),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("usuarios_email_lower_unique").on(sql`lower(${table.email})`)]
);

export type Usuario = typeof usuarios.$inferSelect;
export type NovoUsuario = typeof usuarios.$inferInsert;
