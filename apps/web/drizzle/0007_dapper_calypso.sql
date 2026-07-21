CREATE TABLE "casa_token_migration_aliases" (
	"token_enc" text PRIMARY KEY NOT NULL,
	"casa_id" integer NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "casa_token_migration_aliases_casa_id_unique" UNIQUE("casa_id")
);
--> statement-breakpoint
ALTER TABLE "account_operations" DROP CONSTRAINT "account_operations_type_check";--> statement-breakpoint
ALTER TABLE "account_operations" DROP CONSTRAINT "account_operations_result_check";--> statement-breakpoint
ALTER TABLE "account_operations" ADD COLUMN "operation_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "account_operations" ADD COLUMN "operation_verifier_hash" text;--> statement-breakpoint
ALTER TABLE "casa_token_migration_aliases" ADD CONSTRAINT "casa_token_migration_aliases_casa_id_casas_id_fk" FOREIGN KEY ("casa_id") REFERENCES "public"."casas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_version_check" CHECK ("account_operations"."operation_version" in (1, 2));--> statement-breakpoint
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_verifier_check" CHECK (("account_operations"."operation_version" = 1 and "account_operations"."operation_verifier_hash" is null)
          or ("account_operations"."operation_version" = 2 and (
            ("account_operations"."operation_type" in ('create', 'rotate') and "account_operations"."operation_verifier_hash" is not null)
            or ("account_operations"."operation_type" = 'delete' and "account_operations"."operation_verifier_hash" is null)
          )));--> statement-breakpoint
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_type_check" CHECK ("account_operations"."operation_type" in ('create', 'delete', 'rotate'));--> statement-breakpoint
ALTER TABLE "account_operations" ADD CONSTRAINT "account_operations_result_check" CHECK (("account_operations"."operation_type" in ('create', 'rotate') and "account_operations"."result_token_enc" is not null)
          or ("account_operations"."operation_type" = 'delete' and "account_operations"."result_token_enc" is null));