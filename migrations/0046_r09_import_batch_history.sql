ALTER TABLE "data_imports" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "data_imports" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "data_imports" ADD COLUMN "source" varchar(20);--> statement-breakpoint
ALTER TABLE "data_imports" ADD COLUMN "batch_key" uuid;--> statement-breakpoint
ALTER TABLE "data_imports" ADD COLUMN "fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "data_imports" ADD COLUMN "identity_version" varchar(32);--> statement-breakpoint
ALTER TABLE "data_imports" ADD COLUMN "strategy" varchar(32);--> statement-breakpoint
ALTER TABLE "data_imports" ADD COLUMN "imported_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_imports" ADD COLUMN "duplicate_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_imports" ADD COLUMN "skipped_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_imports" ADD COLUMN "deleted_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_imports" ADD COLUMN "row_outcomes" jsonb;--> statement-breakpoint
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_data_imports_household_batch" ON "data_imports" USING btree ("household_id","batch_key");--> statement-breakpoint
CREATE INDEX "idx_data_imports_account" ON "data_imports" USING btree ("account_id","created_at");