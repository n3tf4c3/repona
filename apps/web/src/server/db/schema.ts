import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

// Tabelas de domínio (por usuário) — espelham o SQLite do mobile
// (apps/mobile/src/storage/database.ts), escopadas ao usuário logado.

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    barcode: text("barcode"),
    photoUri: text("photo_uri"),
    purchaseCount: integer("purchase_count").notNull().default(0),
    status: text("status").notNull().default("active"),
    alertThreshold: text("alert_threshold"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("products_usuario_name_lower_unique").on(
      table.usuarioId,
      sql`lower(${table.name})`
    ),
  ]
);

export const shoppingLists = pgTable(
  "shopping_lists",
  {
    id: serial("id").primaryKey(),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("shopping_lists_usuario_status_idx").on(table.usuarioId, table.status)]
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
    uniqueIndex("shopping_list_items_unique_product").on(
      table.shoppingListId,
      table.productId
    ),
  ]
);

export const purchaseHistory = pgTable("purchase_history", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id),
  quantity: text("quantity").notNull().default("1 un"),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
  sourceListId: integer("source_list_id").references(() => shoppingLists.id, {
    onDelete: "set null",
  }),
});

export const inventoryItems = pgTable("inventory_items", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .notNull()
    .unique()
    .references(() => products.id, { onDelete: "cascade" }),
  quantity: text("quantity").notNull().default("0 un"),
  status: text("status").notNull().default("missing"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  (table) => [index("inventory_events_product_idx").on(table.productId, table.eventType)]
);
