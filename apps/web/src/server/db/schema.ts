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

// Alias temporário usado SOMENTE pelo endpoint de migração de tokens legados.
// Login, sync e exclusão consultam apenas casas.invite_code_enc. A PK impede que
// o mesmo bearer anterior aponte para duas casas e o UNIQUE limita uma grace por
// casa; a geração serializada também exclui colisão cruzada com tokens atuais.
export const casaTokenMigrationAliases = pgTable("casa_token_migration_aliases", {
  tokenEnc: text("token_enc").primaryKey(),
  casaId: integer("casa_id")
    .notNull()
    .unique()
    .references(() => casas.id, { onDelete: "cascade" }),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Registro durável das mutações de conta disparadas pelo mobile. O cliente
// persiste o Idempotency-Key antes do request e o servidor grava a operação na
// mesma transação da criação/exclusão. Assim, timeout ou resposta perdida pode
// ser repetido sem criar outra casa nem transformar uma exclusão já concluída
// em 404. Não há FK para casas de propósito: o recibo de DELETE precisa
// sobreviver à remoção da própria casa. O token de CREATE permanece cifrado.
// (auditoria #90)
export const accountOperations = pgTable(
  "account_operations",
  {
    operationId: uuid("operation_id").primaryKey(),
    // v1 = recibo legado sem verifier; v2 = HMACs estáveis + verifier cliente.
    // DEFAULT 1 torna o db:push compatível com linhas existentes. Todo writer
    // novo grava 2 explicitamente.
    operationVersion: integer("operation_version").notNull().default(1),
    operationType: text("operation_type").notNull(),
    requestHash: text("request_hash").notNull(),
    resultTokenEnc: text("result_token_enc"),
    // Verificador HMAC do segredo de recovery, que existe somente no cliente.
    // operation_id em um dump não basta para recuperar token descriptografado.
    operationVerifierHash: text("operation_verifier_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("account_operations_type_check", sql`${table.operationType} in ('create', 'delete', 'rotate')`),
    check("account_operations_version_check", sql`${table.operationVersion} in (1, 2)`),
    check(
      "account_operations_result_check",
      sql`(${table.operationType} in ('create', 'rotate') and ${table.resultTokenEnc} is not null)
          or (${table.operationType} = 'delete' and ${table.resultTokenEnc} is null)`
    ),
    check(
      "account_operations_verifier_check",
      sql`(${table.operationVersion} = 1 and ${table.operationVerifierHash} is null)
          or (${table.operationVersion} = 2 and (
            (${table.operationType} in ('create', 'rotate') and ${table.operationVerifierHash} is not null)
            or (${table.operationType} = 'delete' and ${table.operationVerifierHash} is null)
          ))`
    ),
  ]
);

// Recibos idempotentes para mutações multi-tabela do web. O operation_id vem
// do browser e é inserido na mesma instrução PostgreSQL que aplica os efeitos;
// uma resposta perdida pode ser repetida sem novo consumo/finalização. (#22)
export const domainOperations = pgTable(
  "domain_operations",
  {
    operationId: uuid("operation_id").primaryKey(),
    casaId: integer("casa_id")
      .notNull()
      .references(() => casas.id, { onDelete: "cascade" }),
    operationType: text("operation_type").notNull(),
    resourceId: integer("resource_id").notNull(),
    resultCount: integer("result_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "domain_operations_type_check",
      sql`${table.operationType} in ('consume', 'finalize-purchase')`
    ),
  ]
);

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
    // Persistida pelo runtime a partir de productNameKey(name), do @repona/core.
    // Nao e derivada pelo PostgreSQL: lower() depende da collation e diverge do
    // locale pt-BR do JavaScript para caracteres como I/İ. (#76)
    nameKey: text("name_key").notNull(),
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
    // O indice usa somente a chave persistida pelo runtime JavaScript. Nao volta
    // a aplicar lower()/collation do PostgreSQL, que diverge do locale pt-BR para
    // caracteres como I/İ; NFC equivalente continua colidindo. (#76)
    uniqueIndex("products_casa_name_key_unique").on(table.casaId, table.nameKey),
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

// Identidades de produto aposentadas por merge administrativo. Um aparelho que
// ficou offline ainda pode reenviar o sync_id antigo; o merge de sync consulta
// esta tabela e encaminha o snapshot/eventos para o produto canônico, em vez de
// recriar a duplicata. A FK composta mantém alias e produto na mesma casa.
// (auditoria #86)
export const productSyncAliases = pgTable(
  "product_sync_aliases",
  {
    id: serial("id").primaryKey(),
    casaId: integer("casa_id")
      .notNull()
      .references(() => casas.id, { onDelete: "cascade" }),
    oldSyncId: uuid("old_sync_id").notNull(),
    canonicalProductId: integer("canonical_product_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_sync_aliases_casa_old_unique").on(table.casaId, table.oldSyncId),
    index("product_sync_aliases_canonical_idx").on(table.canonicalProductId),
    foreignKey({
      columns: [table.canonicalProductId, table.casaId],
      foreignColumns: [products.id, products.casaId],
      name: "product_sync_aliases_product_casa_fk",
    }).onDelete("cascade"),
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
    // Nullable só para linhas legadas. Eventos novos recebem UUID na origem;
    // índice parcial permite a transição sem inventar ids diferentes no servidor
    // e em devices já existentes. (auditoria #73)
    syncId: uuid("sync_id"),
    casaId: integer("casa_id").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    quantity: text("quantity").notNull().default("1 un"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    sourceListId: integer("source_list_id"),
    // Nome da lista de origem denormalizado: sobrevive ao sync (o id é local) e a
    // exclusões da lista. (auditoria #17)
    sourceListName: text("source_list_name"),
    // Tombstone: a edição do histórico no mobile marca deleted em vez de apagar,
    // para a exclusão propagar entre devices sem ser ressuscitada (o merge de
    // compras é append-only). Mesmo racional do deleted em shopping_list_items.
    deleted: boolean("deleted").notNull().default(false),
    // Carimbo da última edição do tombstone (excluir/re-incluir), base do LWW
    // de shouldApplyIncomingDeleted. NULL = nunca editado. (auditoria #65)
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("purchase_history_sync_id_unique")
      .on(table.syncId)
      .where(sql`${table.syncId} is not null`),
    index("purchase_history_product_idx").on(table.productId),
    index("purchase_history_source_list_idx").on(table.sourceListId),
    // Histórico é sempre filtrado por casa e vivo (deleted=false) e ordenado por
    // data; sem este índice a consulta varre por product_id. (auditoria #87)
    index("purchase_history_casa_deleted_data_idx").on(
      table.casaId,
      table.deleted,
      table.purchasedAt.desc(),
      table.id.asc()
    ),
    // Histórico preso à mesma casa do produto; a lista de origem (quando há)
    // também tem de ser da mesma casa. (auditoria #14)
    foreignKey({
      columns: [table.productId, table.casaId],
      foreignColumns: [products.id, products.casaId],
      name: "ph_product_casa_fk",
    }),
    // Uma única FK composta garante que a lista de origem pertence à mesma casa.
    // O delete físico fica deliberadamente restrito: um futuro fluxo de purge deve
    // primeiro nulificar source_list_id na mesma transação. O nome denormalizado
    // continua preservando a origem no histórico. Isso elimina as políticas
    // conflitantes SET NULL/NO ACTION que existiam sobre a mesma coluna. (#31)
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
    syncId: uuid("sync_id"),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    quantity: text("quantity").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("inventory_events_sync_id_unique")
      .on(table.syncId)
      .where(sql`${table.syncId} is not null`),
    index("inventory_events_product_idx").on(table.productId, table.eventType),
    check("inventory_events_event_type_check", sql`${table.eventType} in ('consumed', 'set')`),
  ]
);

export const priceHistory = pgTable(
  "price_history",
  {
    id: serial("id").primaryKey(),
    syncId: uuid("sync_id"),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    priceCents: integer("price_cents").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("price_history_sync_id_unique")
      .on(table.syncId)
      .where(sql`${table.syncId} is not null`),
    index("price_history_product_idx").on(
      table.productId,
      table.recordedAt.desc(),
      table.id.desc()
    ),
  ]
);

// Rate limit e lock de sync sobre o próprio Postgres (auditoria #44). Antes
// dependiam de Vercel KV; como o projeto não usa serviço externo pago, o estado
// distribuído mora no Neon — fonte única, global entre instâncias serverless.

// Contador de rate limit por chave (IP/rota/token). reset_em marca o fim da
// janela; ao expirar, o contador recomeça. As chaves incluem IP e token, de
// cardinalidade não-limitada — a limpeza é a poda oportunística em rateLimit.ts
// (auditoria #49), não a sobrescrita pela própria chave.
export const rateLimits = pgTable(
  "rate_limits",
  {
    chave: text("chave").primaryKey(),
    count: integer("count").notNull(),
    resetEm: timestamp("reset_em", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Índice para a poda oportunística (DELETE WHERE reset_em < now()-1h), que
    // sem ele varre a tabela inteira. (auditoria #87)
    index("rate_limits_reset_em_idx").on(table.resetEm),
  ]
);

// Lock de sync por casa, com dono (token) e TTL. expira_em evita que um merge
// morto tranque a casa para sempre; o token permite compare-and-delete no
// unlock, para um merge que estourou o TTL não apagar o lock de quem o sucedeu.
export const syncLocks = pgTable("sync_locks", {
  chave: text("chave").primaryKey(),
  token: text("token").notNull(),
  expiraEm: timestamp("expira_em", { withTimezone: true }).notNull(),
});
