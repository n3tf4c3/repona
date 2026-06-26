-- OBSOLETO — NÃO É A FONTE DE VERDADE. (auditoria #23)
-- Este projeto aplica o schema com `db:push` a partir de src/server/db/schema.ts,
-- não com `db:migrate`. Este arquivo é histórico e está DESATUALIZADO (ex.: falta
-- products.brand). Veja drizzle/README.md. Não use para criar o banco.
CREATE TABLE "casas" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Minha casa' NOT NULL,
	"invite_code" text NOT NULL,
	"credential_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "casas_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "inventory_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"quantity" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_events_event_type_check" CHECK ("inventory_events"."event_type" in ('consumed'))
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" text DEFAULT '0 un' NOT NULL,
	"status" text DEFAULT 'missing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_product_id_unique" UNIQUE("product_id"),
	CONSTRAINT "inventory_items_status_check" CHECK ("inventory_items"."status" in ('in_stock', 'missing'))
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"casa_id" integer NOT NULL,
	"sync_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"barcode" text,
	"photo_uri" text,
	"purchase_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"alert_threshold" text,
	"archived" boolean DEFAULT false NOT NULL,
	"occasional" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_id_casa_unique" UNIQUE("id","casa_id"),
	CONSTRAINT "products_status_check" CHECK ("products"."status" in ('active', 'missing'))
);
--> statement-breakpoint
CREATE TABLE "purchase_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"casa_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" text DEFAULT '1 un' NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_list_id" integer,
	"source_list_name" text
);
--> statement-breakpoint
CREATE TABLE "shopping_list_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"casa_id" integer NOT NULL,
	"shopping_list_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" text DEFAULT '1 un' NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"casa_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopping_lists_id_casa_unique" UNIQUE("id","casa_id"),
	CONSTRAINT "shopping_lists_status_check" CHECK ("shopping_lists"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_casa_id_casas_id_fk" FOREIGN KEY ("casa_id") REFERENCES "public"."casas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_history" ADD CONSTRAINT "purchase_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_history" ADD CONSTRAINT "purchase_history_source_list_id_shopping_lists_id_fk" FOREIGN KEY ("source_list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_history" ADD CONSTRAINT "ph_product_casa_fk" FOREIGN KEY ("product_id","casa_id") REFERENCES "public"."products"("id","casa_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_history" ADD CONSTRAINT "ph_source_list_casa_fk" FOREIGN KEY ("source_list_id","casa_id") REFERENCES "public"."shopping_lists"("id","casa_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_shopping_list_id_shopping_lists_id_fk" FOREIGN KEY ("shopping_list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "sli_product_casa_fk" FOREIGN KEY ("product_id","casa_id") REFERENCES "public"."products"("id","casa_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "sli_list_casa_fk" FOREIGN KEY ("shopping_list_id","casa_id") REFERENCES "public"."shopping_lists"("id","casa_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_casa_id_casas_id_fk" FOREIGN KEY ("casa_id") REFERENCES "public"."casas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_events_product_idx" ON "inventory_events" USING btree ("product_id","event_type");--> statement-breakpoint
CREATE INDEX "price_history_product_idx" ON "price_history" USING btree ("product_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_casa_name_lower_unique" ON "products" USING btree ("casa_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "products_casa_syncid_unique" ON "products" USING btree ("casa_id","sync_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_casa_barcode_unique" ON "products" USING btree ("casa_id","barcode") WHERE "products"."barcode" is not null;--> statement-breakpoint
CREATE INDEX "purchase_history_product_idx" ON "purchase_history" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "purchase_history_source_list_idx" ON "purchase_history" USING btree ("source_list_id");--> statement-breakpoint
CREATE INDEX "shopping_list_items_product_idx" ON "shopping_list_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_list_items_unique_product" ON "shopping_list_items" USING btree ("shopping_list_id","product_id");--> statement-breakpoint
CREATE INDEX "shopping_lists_casa_status_idx" ON "shopping_lists" USING btree ("casa_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_lists_active_casa_unique" ON "shopping_lists" USING btree ("casa_id") WHERE "shopping_lists"."status" = 'active';