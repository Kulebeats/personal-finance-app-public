-- AH-05: back the "one pending invitation per address" check with a real
-- constraint. The controller's read-then-insert check cannot stop two
-- concurrent invites for the same address from both landing.
--
-- Step 1 (data): collapse pre-existing duplicates BEFORE the unique index is
-- built, or CREATE UNIQUE INDEX would fail on deploy. A duplicate group is the
-- unaccepted invitations of one household for one lower-cased address. We keep
-- the one that expires last (a resend refreshes the expiry, so it carries the
-- most recently mailed link), then the newest, then the highest id, and delete
-- the rest. Expiring them instead would not do: an expired, unaccepted row
-- still falls under the partial index (expiry is time-dependent and cannot be
-- part of an index predicate). Cancelling an invitation already deletes its
-- row, and each invitation's creation stays in audit_logs. Accepted
-- invitations are untouched. Deterministic and idempotent (a no-op once the
-- table is already unique).
DELETE FROM "household_invitations"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "household_id", lower("email")
        ORDER BY "expires_at" DESC, "created_at" DESC NULLS LAST, "id" DESC
      ) AS rn
    FROM "household_invitations"
    WHERE "accepted_at" IS NULL
  ) ranked
  WHERE ranked.rn > 1
);
--> statement-breakpoint
-- Step 2 (schema): one unaccepted invitation per household and address.
CREATE UNIQUE INDEX "household_invitations_pending_email_unique" ON "household_invitations" USING btree ("household_id",lower("email")) WHERE accepted_at IS NULL;
