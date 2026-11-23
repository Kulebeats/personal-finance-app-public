CREATE TABLE "storage_objects" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"upload_name" varchar(500) NOT NULL,
	"household_id" uuid NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"size" integer NOT NULL,
	"media_type" varchar(100) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"moved_from_legacy_at" timestamp,
	CONSTRAINT "chk_storage_objects_sha256" CHECK ("storage_objects"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "chk_storage_objects_size" CHECK ("storage_objects"."size" > 0)
);
--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_storage_objects_upload_name" ON "storage_objects" USING btree ("upload_name");--> statement-breakpoint
CREATE INDEX "idx_storage_objects_upload_name_lower" ON "storage_objects" USING btree (lower("upload_name"));--> statement-breakpoint
CREATE INDEX "idx_storage_objects_household" ON "storage_objects" USING btree ("household_id");