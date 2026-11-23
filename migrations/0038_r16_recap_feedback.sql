CREATE TABLE "weekly_recap_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"week_end" date NOT NULL,
	"step" varchar(20) NOT NULL,
	"choice" varchar(10) NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_weekly_recap_feedback_week" CHECK ("weekly_recap_feedback"."week_end" = "weekly_recap_feedback"."week_start" + 6),
	CONSTRAINT "chk_weekly_recap_feedback_step" CHECK ("weekly_recap_feedback"."step" IN ('net-worth', 'spending', 'recurring', 'goals', 'wrap-up', 'overall')),
	CONSTRAINT "chk_weekly_recap_feedback_choice" CHECK ("weekly_recap_feedback"."choice" IN ('positive', 'negative')),
	CONSTRAINT "chk_weekly_recap_feedback_comment" CHECK ("weekly_recap_feedback"."comment" IS NULL OR char_length("weekly_recap_feedback"."comment") <= 500)
);
--> statement-breakpoint
ALTER TABLE "weekly_recap_feedback" ADD CONSTRAINT "weekly_recap_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_recap_feedback" ADD CONSTRAINT "weekly_recap_feedback_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_weekly_recap_feedback_identity" ON "weekly_recap_feedback" USING btree ("user_id","household_id","week_start","step");--> statement-breakpoint
CREATE INDEX "idx_weekly_recap_feedback_household_week" ON "weekly_recap_feedback" USING btree ("household_id","week_start");