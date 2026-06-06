DO $$
DECLARE
  r RECORD;
  novo_id integer;
BEGIN
  FOR r IN SELECT id FROM usuarios WHERE casa_id IS NULL LOOP
    INSERT INTO casas (name, invite_code)
      VALUES ('Minha casa', upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)))
      RETURNING id INTO novo_id;
    UPDATE usuarios SET casa_id = novo_id WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "casa_id" SET NOT NULL;
--> statement-breakpoint
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY casa_id ORDER BY created_at DESC, id DESC) AS rn
  FROM "shopping_lists"
  WHERE status = 'active'
)
UPDATE "shopping_lists"
SET status = 'archived', updated_at = now()
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
--> statement-breakpoint
CREATE UNIQUE INDEX "shopping_lists_active_casa_unique" ON "shopping_lists" USING btree ("casa_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE INDEX "shopping_list_items_product_idx" ON "shopping_list_items" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX "purchase_history_product_idx" ON "purchase_history" USING btree ("product_id");
--> statement-breakpoint
CREATE INDEX "purchase_history_source_list_idx" ON "purchase_history" USING btree ("source_list_id");
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_status_check" CHECK ("status" in ('active', 'missing'));
--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_status_check" CHECK ("status" in ('active', 'archived'));
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_status_check" CHECK ("status" in ('in_stock', 'missing'));
--> statement-breakpoint
ALTER TABLE "inventory_events" ADD CONSTRAINT "inventory_events_event_type_check" CHECK ("event_type" in ('consumed'));
