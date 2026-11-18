-- Back the filter-preset duplicate-name check with a real constraint.
-- The service's read-then-insert check cannot stop two concurrent creates
-- (or a create racing a rename) from landing the same name in one scope.
--
-- Step 1 (data): collapse pre-existing duplicate names BEFORE the unique
-- index is built. Per duplicate group we keep the default preset if any,
-- then the earliest created, then the lowest id. Deterministic and
-- idempotent (a no-op once the table is already unique).
DELETE FROM "filter_presets"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "household_id", "user_id", "context", "name"
        ORDER BY
          CASE WHEN "is_default" THEN 0 ELSE 1 END,
          "created_at" NULLS LAST,
          "id"
      ) AS rn
    FROM "filter_presets"
  ) ranked
  WHERE ranked.rn > 1
);
--> statement-breakpoint
-- Step 2 (schema): a preset name is unique per household/user/context.
CREATE UNIQUE INDEX "filter_presets_name_unique_per_scope" ON "filter_presets" USING btree ("household_id","user_id","context","name");
