-- Forward repair of exact outcomes changed by 0060. Archived duplicate
-- completions remain historical successes and do not own the unique fence.
ALTER TABLE "jobs" ADD COLUMN "archived_duplicate_completion" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
DROP INDEX "idx_jobs_scheduled_period_completed";
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_jobs_scheduled_period_completed" ON "jobs" ("name", "idempotency_key")
WHERE "name" LIKE 'scheduled:%' AND "status" = 'completed' AND NOT "archived_duplicate_completion";
--> statement-breakpoint

WITH recovered AS (
  SELECT legacy."id",
    EXISTS (
      SELECT 1 FROM "jobs" AS winner
      WHERE winner."name" = legacy."name"
        AND winner."idempotency_key" = legacy."idempotency_key"
        AND winner."status" = 'completed'
    ) AS has_winner,
    row_number() OVER (
      PARTITION BY legacy."name", legacy."idempotency_key"
      ORDER BY legacy."completed_at" ASC NULLS LAST, legacy."created_at" ASC, legacy."id" ASC
    ) AS position
  FROM "jobs" AS legacy
  WHERE legacy."name" LIKE 'scheduled:%' AND legacy."idempotency_key" IS NOT NULL
    AND legacy."status" = 'failed' AND legacy."last_error" = 'DUPLICATE_COMPLETION'
)
UPDATE "jobs" AS legacy SET "status" = 'completed', "last_error" = NULL,
  "archived_duplicate_completion" = recovered.has_winner OR recovered.position > 1
FROM recovered WHERE legacy."id" = recovered."id";
--> statement-breakpoint

-- Preserve the grace anchor before retention can prune the first attempt.
WITH first_attempts AS (
  SELECT 'scheduler:catalogued:' || substring("name" from length('scheduled:') + 1) AS marker,
    min("started_at") AS started_at
  FROM "jobs" WHERE "name" LIKE 'scheduled:%' AND "started_at" IS NOT NULL
  GROUP BY "name"
)
UPDATE "jobs" AS marker SET "started_at" = first_attempts.started_at
FROM first_attempts WHERE marker."name" = first_attempts.marker
  AND first_attempts.started_at < marker."started_at";
