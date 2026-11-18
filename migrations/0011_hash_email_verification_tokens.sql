-- Custom SQL migration file, put your code below! --

-- P7a: users.email_verification_token now stores a SHA-256 hash of the
-- token instead of the raw value (see server/core/tokenHash.ts). Any
-- outstanding raw token already persisted under the old scheme will never
-- match a hash lookup again, so clear it: the affected user simply
-- requests a new verification/change link. This also clears
-- email_verification_expiry and pending_email so a stale email-change
-- request doesn't linger with no way to complete it.
UPDATE "users"
SET
  "email_verification_token" = NULL,
  "email_verification_expiry" = NULL,
  "pending_email" = NULL
WHERE "email_verification_token" IS NOT NULL;
