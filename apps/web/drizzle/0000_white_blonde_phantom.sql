CREATE TABLE "usuarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text,
	"email" text NOT NULL,
	"senha_hash" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_lower_unique" ON "usuarios" USING btree (lower("email"));