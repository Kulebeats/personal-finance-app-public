CREATE TABLE "storage_purge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_name" varchar(500) NOT NULL,
	"object_key" varchar(128),
	"keep_legacy" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp,
	CONSTRAINT "chk_storage_purge_items_attempts" CHECK ("storage_purge_items"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_storage_purge_items_upload_name" ON "storage_purge_items" USING btree ("upload_name");