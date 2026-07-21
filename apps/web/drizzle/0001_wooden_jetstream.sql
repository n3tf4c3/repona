CREATE TABLE "account_operations" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"operation_type" text NOT NULL,
	"request_hash" text NOT NULL,
	"result_token_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_operations_type_check" CHECK ("account_operations"."operation_type" in ('create', 'delete')),
	CONSTRAINT "account_operations_result_check" CHECK (("account_operations"."operation_type" = 'create' and "account_operations"."result_token_enc" is not null)
          or ("account_operations"."operation_type" = 'delete' and "account_operations"."result_token_enc" is null))
);
