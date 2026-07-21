CREATE TABLE "product_sync_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"casa_id" integer NOT NULL,
	"old_sync_id" uuid NOT NULL,
	"canonical_product_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_sync_aliases" ADD CONSTRAINT "product_sync_aliases_casa_id_casas_id_fk" FOREIGN KEY ("casa_id") REFERENCES "public"."casas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sync_aliases" ADD CONSTRAINT "product_sync_aliases_product_casa_fk" FOREIGN KEY ("canonical_product_id","casa_id") REFERENCES "public"."products"("id","casa_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_sync_aliases_casa_old_unique" ON "product_sync_aliases" USING btree ("casa_id","old_sync_id");--> statement-breakpoint
CREATE INDEX "product_sync_aliases_canonical_idx" ON "product_sync_aliases" USING btree ("canonical_product_id");