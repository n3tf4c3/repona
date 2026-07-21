ALTER TABLE "inventory_events" DROP CONSTRAINT "inventory_events_event_type_check";--> statement-breakpoint
DROP INDEX "price_history_product_idx";--> statement-breakpoint
DROP INDEX "purchase_history_casa_deleted_data_idx";--> statement-breakpoint
ALTER TABLE "inventory_events" ADD COLUMN "sync_id" uuid;--> statement-breakpoint
ALTER TABLE "price_history" ADD COLUMN "sync_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_history" ADD COLUMN "sync_id" uuid;--> statement-breakpoint
UPDATE "purchase_history" SET "sync_id" = gen_random_uuid() WHERE "sync_id" IS NULL;--> statement-breakpoint
UPDATE "price_history" SET "sync_id" = gen_random_uuid() WHERE "sync_id" IS NULL;--> statement-breakpoint
UPDATE "inventory_events" SET "sync_id" = gen_random_uuid() WHERE "sync_id" IS NULL;--> statement-breakpoint
INSERT INTO "inventory_events" ("sync_id", "product_id", "event_type", "quantity", "occurred_at")
SELECT p."sync_id", ii."product_id", 'set', ii."quantity",
       GREATEST(
         ii."updated_at",
         COALESCE(MAX(ie."occurred_at") + interval '1 millisecond', ii."updated_at")
       )
FROM "inventory_items" ii
INNER JOIN "products" p ON p."id" = ii."product_id"
LEFT JOIN "inventory_events" ie ON ie."product_id" = ii."product_id"
GROUP BY ii."product_id", p."sync_id", ii."quantity", ii."updated_at";--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_events_sync_id_unique" ON "inventory_events" USING btree ("sync_id") WHERE "inventory_events"."sync_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "price_history_sync_id_unique" ON "price_history" USING btree ("sync_id") WHERE "price_history"."sync_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_history_sync_id_unique" ON "purchase_history" USING btree ("sync_id") WHERE "purchase_history"."sync_id" is not null;--> statement-breakpoint
CREATE INDEX "price_history_product_idx" ON "price_history" USING btree ("product_id","recorded_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchase_history_casa_deleted_data_idx" ON "purchase_history" USING btree ("casa_id","deleted","purchased_at" DESC NULLS LAST,"id");--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_event_type_check" CHECK ("inventory_events"."event_type" in ('consumed', 'set'));
