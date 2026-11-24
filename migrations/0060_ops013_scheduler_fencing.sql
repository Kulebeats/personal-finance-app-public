-- OPS-013: at most one running and one completed run per scheduled period.
-- Existing duplicates are closed first so the indexes can be built: of several
-- running rows of one period only the newest can still hold the period's lock,
-- so the older ones are closed as superseded; of several completed rows the
-- first completion stands and later ones are marked failed as duplicates.
UPDATE "jobs" SET "status" = 'failed', "last_error" = 'RUN_SUPERSEDED',
  "completed_at" = coalesce("completed_at", now()), "updated_at" = now()
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "name", "idempotency_key"
      ORDER BY "started_at" DESC NULLS LAST, "created_at" DESC, "id" DESC) AS "rank"
    FROM "jobs"
    WHERE "name" LIKE 'scheduled:%' AND "status" = 'running' AND "idempotency_key" IS NOT NULL
  ) AS "ranked" WHERE "rank" > 1
);--> statement-breakpoint
UPDATE "jobs" SET "status" = 'failed', "last_error" = 'DUPLICATE_COMPLETION', "updated_at" = now()
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "name", "idempotency_key"
      ORDER BY "completed_at" ASC NULLS LAST, "created_at" ASC, "id" ASC) AS "rank"
    FROM "jobs"
    WHERE "name" LIKE 'scheduled:%' AND "status" = 'completed' AND "idempotency_key" IS NOT NULL
  ) AS "ranked" WHERE "rank" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_jobs_scheduled_period_running" ON "jobs" USING btree ("name","idempotency_key") WHERE "jobs"."name" LIKE 'scheduled:%' AND "jobs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_jobs_scheduled_period_completed" ON "jobs" USING btree ("name","idempotency_key") WHERE "jobs"."name" LIKE 'scheduled:%' AND "jobs"."status" = 'completed';
