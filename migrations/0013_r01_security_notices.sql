ALTER TYPE "public"."outbox_event_status" ADD VALUE 'unknown';--> statement-breakpoint
ALTER TYPE "public"."outbox_event_status" ADD VALUE 'suppressed';--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dispatch_claim_token" uuid;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dispatch_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dispatch_lease_until" timestamp;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "dispatch_started_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_outbox_security_notice_identity" ON "outbox_events" USING btree ("aggregate_id",lower("payload"->>'recipient'),("payload"->>'channel')) WHERE "outbox_events"."event_type" = 'security.notice.requested';