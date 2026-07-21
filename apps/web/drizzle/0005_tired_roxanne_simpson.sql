DROP INDEX "products_casa_name_lower_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "products_casa_name_key_unique" ON "products" USING btree ("casa_id",lower(normalize(btrim("name"), NFC)));