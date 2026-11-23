CREATE TABLE "ai_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"stage" varchar(16) NOT NULL,
	"ordinal" integer NOT NULL,
	"provider" varchar(16) NOT NULL,
	"model" varchar(128),
	"reported_model" varchar(128),
	"status" varchar(16) DEFAULT 'dispatched' NOT NULL,
	"failure_category" varchar(32),
	"provider_request_id" varchar(128),
	"identity_erased" boolean DEFAULT false NOT NULL,
	"usage_known" boolean DEFAULT false NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_tokens" integer,
	"cache_write_tokens" integer,
	"deadline_at" timestamp NOT NULL,
	"dispatched_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "chk_ai_attempts_stage" CHECK ("ai_attempts"."stage" IN ('analysis', 'answer')),
	CONSTRAINT "chk_ai_attempts_provider" CHECK ("ai_attempts"."provider" IN ('anthropic', 'gemini')),
	CONSTRAINT "chk_ai_attempts_status" CHECK ("ai_attempts"."status" IN ('dispatched', 'not_dispatched', 'succeeded', 'failed', 'usage_unknown')),
	CONSTRAINT "chk_ai_attempts_ordinal" CHECK ("ai_attempts"."ordinal" > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" varchar(16) NOT NULL,
	"consent_version" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_ai_consent_events_action" CHECK ("ai_consent_events"."action" IN ('grant', 'revoke')),
	CONSTRAINT "chk_ai_consent_events_version" CHECK (("ai_consent_events"."action" = 'grant') = ("ai_consent_events"."consent_version" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"client_request_key" varchar(128) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"consent_version" varchar(10),
	"status" varchar(16) DEFAULT 'in_progress' NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"chat_quota_state" varchar(16) DEFAULT 'reserved' NOT NULL,
	"answer_mode" varchar(16),
	"response_body" jsonb,
	"conversation_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "chk_ai_requests_status" CHECK ("ai_requests"."status" IN ('in_progress', 'completed', 'failed')),
	CONSTRAINT "chk_ai_requests_quota" CHECK ("ai_requests"."chat_quota_state" IN ('reserved', 'consumed', 'refunded')),
	CONSTRAINT "chk_ai_requests_answer_mode" CHECK ("ai_requests"."answer_mode" IS NULL OR "ai_requests"."answer_mode" IN ('claude', 'gemini', 'local', 'unavailable')),
	CONSTRAINT "chk_ai_requests_terminal" CHECK (("ai_requests"."status" = 'in_progress') = ("ai_requests"."completed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "ai_attempts" ADD CONSTRAINT "ai_attempts_request_id_ai_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ai_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_consent_events" ADD CONSTRAINT "ai_consent_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_consent_events" ADD CONSTRAINT "ai_consent_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ai_attempts_claim" ON "ai_attempts" USING btree ("request_id","stage","ordinal");--> statement-breakpoint
CREATE INDEX "idx_ai_attempts_provider_model_completed" ON "ai_attempts" USING btree ("provider","model","completed_at");--> statement-breakpoint
CREATE INDEX "idx_ai_consent_events_household_created" ON "ai_consent_events" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ai_requests_identity" ON "ai_requests" USING btree ("household_id","actor_id","client_request_key");--> statement-breakpoint
CREATE INDEX "idx_ai_requests_household_created" ON "ai_requests" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_requests_conversation" ON "ai_requests" USING btree ("conversation_id");