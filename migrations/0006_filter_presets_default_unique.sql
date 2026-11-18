-- Enforce one default filter preset per (household_id, user_id, context).
--
-- Step 1 (data): if duplicate defaults already exist, keep the most recently
-- updated/created row as default and demote the rest before the unique index is
-- built. This makes the migration safe on non-empty production databases.
UPDATE "filter_presets"
SET "is_default" = false,
    "updated_at" = now()
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "household_id", "user_id", "context"
        ORDER BY "updated_at" DESC NULLS LAST, "created_at" DESC NULLS LAST, "id" DESC
      ) AS rn
    FROM "filter_presets"
    WHERE "is_default" = true
  ) ranked
  WHERE ranked.rn > 1
);
--> statement-breakpoint
-- Step 2 (schema): only one default may remain true per scope.
CREATE UNIQUE INDEX "filter_presets_one_default_per_scope" ON "filter_presets" USING btree ("household_id","user_id","context") WHERE is_default = true;
