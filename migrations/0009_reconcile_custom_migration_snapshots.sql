-- Reconcile Drizzle's generated snapshot with the schema changes applied by
-- custom migrations 0007 and 0008. Both statements are idempotent because
-- those migrations may already have created the database objects.
CREATE UNIQUE INDEX IF NOT EXISTS "filter_presets_name_unique_per_scope"
  ON "filter_presets" USING btree ("household_id","user_id","context","name");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_budgets_period_monthly'
      AND conrelid = 'budgets'::regclass
  ) THEN
    ALTER TABLE "budgets"
      ADD CONSTRAINT "chk_budgets_period_monthly"
      CHECK ("period" = 'monthly');
  END IF;
END $$;
