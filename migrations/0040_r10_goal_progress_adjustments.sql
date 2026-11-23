-- #222: goal progress changes that are not a link or a contribution (goal
-- transfers in and out, partial-balance assignments) get their own place in
-- the goal's applied order and a stored effect, so a refold replays them
-- where they happened. Adds a table and refuses no existing row; older
-- transfers and assignments stay in each goal's base (no backfill).
-- Idempotent, like 0010, so db:migrate survives a database built by push.
CREATE TABLE IF NOT EXISTS "goal_progress_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"ref_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"applied_delta" numeric(15, 2) NOT NULL,
	"placed_at" timestamp NOT NULL,
	"created_by" uuid,
	CONSTRAINT "chk_goal_progress_adjustments_kind" CHECK (kind IN ('transfer_in', 'transfer_out', 'assignment')),
	CONSTRAINT "chk_goal_progress_adjustments_amount" CHECK (amount <> 0)
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_progress_adjustments_goal_id_goals_id_fk'
      AND conrelid = 'goal_progress_adjustments'::regclass
  ) THEN
    ALTER TABLE "goal_progress_adjustments" ADD CONSTRAINT "goal_progress_adjustments_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_progress_adjustments_created_by_users_id_fk'
      AND conrelid = 'goal_progress_adjustments'::regclass
  ) THEN
    ALTER TABLE "goal_progress_adjustments" ADD CONSTRAINT "goal_progress_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_goal_progress_adjustments_goal" ON "goal_progress_adjustments" USING btree ("goal_id","placed_at");
