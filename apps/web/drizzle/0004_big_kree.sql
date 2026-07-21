CREATE TABLE "domain_operations" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"casa_id" integer NOT NULL,
	"operation_type" text NOT NULL,
	"resource_id" integer NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_operations_type_check" CHECK ("domain_operations"."operation_type" in ('consume', 'finalize-purchase'))
);
--> statement-breakpoint
ALTER TABLE "domain_operations" ADD CONSTRAINT "domain_operations_casa_id_casas_id_fk" FOREIGN KEY ("casa_id") REFERENCES "public"."casas"("id") ON DELETE cascade ON UPDATE no action;