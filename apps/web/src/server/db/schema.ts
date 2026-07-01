import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  uniqueIndex,
  unique,
  foreignKey,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Casa (household) = a conta. Criada no mobile, identificada pelo token. É a
// unidade de compartilhamento: produtos, lista, estoque e histórico são
// escopados por casa. O login do web é só o token.
export const casas = pgTable("casas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("Minha casa"),
  // Token de acesso cifrado em repouso (auditoria #43): AES-256-GCM
  // determinístico (ver server/inviteToken.ts). Determinístico para permitir
  // lookup por igualdade e manter o índice único; reversível para reexibir o
  // token na tela de perfil. Nunca guardamos o token em claro.
  inviteCodeEnc: text("invite_code_enc").notNull().unique(),
  // Versão da credencial: incrementa ao regenerar o token. O JWT da sessão web
  // guarda o valor de quando logou; se divergir do banco, a sessão é encerrada.
  // Assim regenerar o código também revoga as sessões web ativas. (auditoria #13)
  credentialVersion: integer("credential_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Casa = typeof casas.$inferSelect;

// Tabelas de domínio (por casa) — espelham o SQLite do mobile
// (apps/mobile/src/storage/database.ts), escopadas à casa.

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    casaId: integer("casa_id")
      .notNull()
      .references(() => casas.id, { onDelete: "cascade" }),
    syncId: uuid("sync_id").notNull().defaultRandom(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    brand: text("brand"),
    barcode: text("barcode"),
    photoUri: text("photo_uri"),
    purchaseCount: integer("purchase_count").notNull().default(0),
    status: text("status").notNull().default("active"),
    alertThreshold: text("alert_threshold"),
    archived: boolean("archived").notNull().default(false),
    occasional: boolean("occasional").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("products_casa_name_lower_unique").on(table.casaId, sql`lower(${table.name})`),
    uniqueIndex("products_casa_syncid_unique").on(table.casaId, table.syncId),
    // Um código de barras é único por casa (parcial: NULL não colide, então
    // hortifrúti sem código fica livre). Fecha a duplicata por barcode na origem,
    // junto com o casamento por barcode no sync. (auditoria 2026-06-09 #1)
    uniqueIndex("products_casa_barcode_unique")
      .on(table.casaId, table.barcode)
      .where(sql`${table.barcode} is not null`),
    check("products_status_check", sql`${table.status} in ('active', 'missing')`),
    // Alvo das FKs compostas das filhas: garante que o filho fique na mesma casa
    // do produto. (auditoria #14)
    unique("products_id_casa_unique").on(table.id, table.casaId),
  ]
);

export const shoppingLists = pgTable(
  "shopping_lists",
  {
    id: serial("id").primaryKey(),
    casaId: integer("casa_id")
      .notNull()
      .references(() => casas.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("shopping_lists_casa_status_idx").on(table.casaId, table.status),
    uniqueIndex("shopping_lists_active_casa_unique")
      .on(table.casaId)
      .where(sql`${table.status} = 'active'`),
    check("shopping_lists_status_check", sql`${table.status} in ('active', 'archived')`),
    // Alvo das FKs compostas (item/histórico na mesma casa da lista). (auditoria #14)
    unique("shopping_lists_id_casa_unique").on(table.id, table.casaId),
  ]
);

export const shoppingListItems = pgTable(
  "shopping_list_items",
  {
    id: serial("id").primaryKey(),
    casaId: integer("casa_id").notNull(),
    shoppingListId: integer("shopping_list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: text("quantity").notNull().default("1 un"),
    checked: boolean("checked").notNull().default(false),
    // Tombstone de sync: finalizar/remover marca deleted em vez de apagar, para
    // a deleção propagar sem ser ressuscitada por outro device. (auditoria #9)
    deleted: boolean("deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("shopping_list_items_product_idx").on(table.productId),
    uniqueIndex("shopping_list_items_unique_product").on(
      table.shoppingListId,
      table.productId
    ),
    // Item preso à mesma casa do produto e da lista. (auditoria #14)
    foreignKey({
      columns: [table.productId, table.casaId],
      foreignColumns: [products.id, products.casaId],
      name: "sli_product_casa_fk",
    }),
    foreignKey({
      columns: [table.shoppingListId, table.casaId],
      foreignColumns: [shoppingLists.id, shoppingLists.casaId],
      name: "sli_list_casa_fk",
    }),
  ]
);

export const purchaseHistory = pgTable(
  "purchase_history",
  {
    id: serial("id").primaryKey(),
    casaId: integer("casa_id").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    quantity: text("quantity").notNull().default("1 un"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    sourceListId: integer("source_list_id").references(() => shoppingLists.id, {
      onDelete: "set null",
    }),
    // Nome da lista de origem denormalizado: sobrevive ao sync (o id é local) e a
    // exclusões da lista. (auditoria #17)
    sourceListName: text("source_list_name"),
  },
  (table) => [
    index("purchase_history_product_idx").on(table.productId),
    index("purchase_history_source_list_idx").on(table.sourceListId),
    // Histórico preso à mesma casa do produto; a lista de origem (quando há)
    // também tem de ser da mesma casa. (auditoria #14)
    foreignKey({
      columns: [table.productId, table.casaId],
      foreignColumns: [products.id, products.casaId],
      name: "ph_product_casa_fk",
    }),
    // A FK simples de source_list_id é ON DELETE SET NULL (preserva o histórico
    // ao remover a lista, auditoria #17); esta composta fica NO ACTION. A
    // diferença só "conflitaria" num DELETE físico de shopping_lists — que o app
    // nunca faz (listas são arquivadas, status 'archived', nunca apagadas), então
    // o conflito não dispara. O valor durável da origem é sourceListName.
    // Normalização (dropar esta composta redundante) fica para uma migration
    // dedicada, fora do db:push de rotina. (auditoria #31, DOCUMENTADO)
    foreignKey({
      columns: [table.sourceListId, table.casaId],
      foreignColumns: [shoppingLists.id, shoppingLists.casaId],
      name: "ph_source_list_casa_fk",
    }),
  ]
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .unique()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: text("quantity").notNull().default("0 un"),
    status: text("status").notNull().default("missing"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("inventory_items_status_check", sql`${table.status} in ('in_stock', 'missing')`)]
);

export const inventoryEvents = pgTable(
  "inventory_events",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    quantity: text("quantity").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_events_product_idx").on(table.productId, table.eventType),
    check("inventory_events_event_type_check", sql`${table.eventType} in ('consumed')`),
  ]
);

export const priceHistory = pgTable(
  "price_history",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("price_history_product_idx").on(table.productId, table.recordedAt)]
);

// Rate limit e lock de sync sobre o próprio Postgres (auditoria #44). Antes
// dependiam de Vercel KV; como o projeto não usa serviço externo pago, o estado
// distribuído mora no Neon — fonte única, global entre instâncias serverless.

// Contador de rate limit por chave (IP/rota/token). reset_em marca o fim da
// janela; ao expirar, o contador recomeça. As chaves incluem IP e token, de
// cardinalidade não-limitada — a limpeza é a poda oportunística em rateLimit.ts
// (auditoria #49), não a sobrescrita pela própria chave.
export const rateLimits = pgTable("rate_limits", {
  chave: text("chave").primaryKey(),
  count: integer("count").notNull(),
  resetEm: timestamp("reset_em", { withTimezone: true }).notNull(),
});

// Lock de sync por casa, com dono (token) e TTL. expira_em evita que um merge
// morto tranque a casa para sempre; o token permite compare-and-delete no
// unlock, para um merge que estourou o TTL não apagar o lock de quem o sucedeu.
export const syncLocks = pgTable("sync_locks", {
  chave: text("chave").primaryKey(),
  token: text("token").notNull(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
});
