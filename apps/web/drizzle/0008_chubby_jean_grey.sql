BEGIN;
--> statement-breakpoint
DO $repona_product_name_key$
DECLARE
  column_exists boolean;
  needs_backfill boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_attribute
    WHERE attrelid = 'products'::regclass
      AND attname = 'name_key'
      AND attnum > 0
      AND NOT attisdropped
  ) INTO column_exists;

  IF NOT column_exists THEN
    SELECT EXISTS (SELECT 1 FROM products) INTO needs_backfill;
  ELSE
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM products WHERE name_key IS NULL)'
      INTO needs_backfill;
  END IF;

  IF needs_backfill THEN
    RAISE EXCEPTION 'PRODUCT_NAME_KEY_BACKFILL_REQUIRED'
      USING HINT = 'Execute db:product-name-key -- --yes antes de aplicar o schema.';
  END IF;
END
$repona_product_name_key$;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "name_key" text;
--> statement-breakpoint
DROP INDEX IF EXISTS "products_casa_name_key_unique";
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "name_key" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "products_casa_name_key_unique"
  ON "products" USING btree ("casa_id", "name_key");
--> statement-breakpoint
COMMIT;
