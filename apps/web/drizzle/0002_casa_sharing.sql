CREATE TABLE "casas" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Minha casa' NOT NULL,
	"invite_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "casas_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "casa_id" integer;
--> statement-breakpoint
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
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_casa_id_casas_id_fk" FOREIGN KEY ("casa_id") REFERENCES "public"."casas"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "casa_id" integer;
--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD COLUMN "casa_id" integer;
--> statement-breakpoint
UPDATE "products" p SET casa_id = u.casa_id FROM usuarios u WHERE u.id = p.usuario_id;
--> statement-breakpoint
UPDATE "shopping_lists" s SET casa_id = u.casa_id FROM usuarios u WHERE u.id = s.usuario_id;
--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "casa_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "shopping_lists" ALTER COLUMN "casa_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_casa_id_casas_id_fk" FOREIGN KEY ("casa_id") REFERENCES "public"."casas"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_casa_id_casas_id_fk" FOREIGN KEY ("casa_id") REFERENCES "public"."casas"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DROP INDEX IF EXISTS "products_usuario_name_lower_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "shopping_lists_usuario_status_idx";
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_usuario_id_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "shopping_lists" DROP CONSTRAINT IF EXISTS "shopping_lists_usuario_id_usuarios_id_fk";
--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "usuario_id";
--> statement-breakpoint
ALTER TABLE "shopping_lists" DROP COLUMN "usuario_id";
--> statement-breakpoint
CREATE UNIQUE INDEX "products_casa_name_lower_unique" ON "products" USING btree ("casa_id",lower("name"));
--> statement-breakpoint
CREATE INDEX "shopping_lists_casa_status_idx" ON "shopping_lists" USING btree ("casa_id","status");
