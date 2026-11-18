-- Enforce one membership per (household_id, user_id).
--
-- Step 1 (data): collapse any pre-existing duplicate membership rows BEFORE the
-- unique index is built, or the CREATE UNIQUE INDEX would fail on a non-empty
-- production database. Per duplicate group we keep the most-privileged role
-- (then earliest join, then lowest id) and delete the rest. Deterministic and
-- idempotent (a no-op once the table is already unique).
DELETE FROM "household_members"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "household_id", "user_id"
        ORDER BY
          CASE "role"
            WHEN 'owner' THEN 0
            WHEN 'admin' THEN 1
            WHEN 'member' THEN 2
            WHEN 'view_only' THEN 3
            ELSE 4
          END,
          "joined_at" NULLS LAST,
          "id"
      ) AS rn
    FROM "household_members"
  ) ranked
  WHERE ranked.rn > 1
);
--> statement-breakpoint
-- Step 2 (schema): a user may belong to a household at most once.
CREATE UNIQUE INDEX "household_members_household_user_unique" ON "household_members" USING btree ("household_id","user_id");
