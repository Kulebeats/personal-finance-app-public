CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_key" varchar(200) NOT NULL,
	"channel" varchar(10) NOT NULL,
	"status" varchar(12) NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"reason" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notif_delivery_channel_valid" CHECK ("notification_deliveries"."channel" IN ('email', 'push')),
	CONSTRAINT "notif_delivery_status_valid" CHECK ("notification_deliveries"."status" IN ('pending', 'sent', 'failed', 'unknown', 'suppressed'))
);
--> statement-breakpoint
ALTER TABLE "user_quiet_hours" ADD COLUMN "timezone" varchar(64) DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notif_delivery_event_channel" ON "notification_deliveries" USING btree ("user_id","event_key","channel");