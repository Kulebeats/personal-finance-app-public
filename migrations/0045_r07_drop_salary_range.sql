-- AH-07: salary range is no longer collected (owner decision, 17 Nov 2026).
-- No code reads or writes the column; IF EXISTS keeps a push-built database safe.
ALTER TABLE "users" DROP COLUMN IF EXISTS "salary_range_encrypted";
