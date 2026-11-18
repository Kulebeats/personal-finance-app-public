-- Enforce the intentionally monthly-only budget period contract.
--
-- The API rejects yearly/custom periods until period-aware progress and
-- forecast calculations exist. Backfill any historical rows before adding the
-- database guard so direct writes and old data cannot drift from that contract.
UPDATE "budgets"
SET "period" = 'monthly',
    "updated_at" = now()
WHERE "period" <> 'monthly';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_budgets_period_monthly'
  ) THEN
    ALTER TABLE "budgets"
      ADD CONSTRAINT "chk_budgets_period_monthly"
      CHECK ("period" = 'monthly');
  END IF;
END $$;
