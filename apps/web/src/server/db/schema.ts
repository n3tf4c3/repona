import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Casa (household) = a conta. Criada no mobile, identificada pelo inviteCode
// (token). É a unidade de compartilhamento: produtos, lista, estoque e
// histórico são escopados por casa. O login do web é só o token.
export const casas = pgTable("casas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().default("Minha casa"),
  inviteCode: text("invite_code").notNull().unique(),
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
    check("products_status_check", sql`${table.status} in ('active', 'missing')`),
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
  ]
);

export const shoppingListItems = pgTable(
  "shopping_list_items",
  {
    id: serial("id").primaryKey(),
    shoppingListId: integer("shopping_list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: text("quantity").notNull().default("1 un"),
    checked: boolean("checked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("shopping_list_items_product_idx").on(table.productId),
    uniqueIndex("shopping_list_items_unique_product").on(
      table.shoppingListId,
      table.productId
    ),
  ]
);

export const purchaseHistory = pgTable(
  "purchase_history",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    quantity: text("quantity").notNull().default("1 un"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    sourceListId: integer("source_list_id").references(() => shoppingLists.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("purchase_history_product_idx").on(table.productId),
    index("purchase_history_source_list_idx").on(table.sourceListId),
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
