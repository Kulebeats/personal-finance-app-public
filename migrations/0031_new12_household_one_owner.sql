-- NEW-12 (P0): a household has at most one owner.
-- The ownership service keeps every household at exactly one owner under row
-- locks; this partial unique index makes a second owner row impossible to write.
-- No backfill: a database that already holds a household with two owner rows
-- fails this statement, and that household must be repaired by hand first.
CREATE UNIQUE INDEX "household_members_one_owner" ON "household_members" USING btree ("household_id") WHERE role = 'owner';
