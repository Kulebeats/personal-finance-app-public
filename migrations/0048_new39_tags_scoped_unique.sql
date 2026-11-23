-- NEW-39: refuse, never repair. Duplicate tags are not merged or renamed here; run
-- scripts/report-tag-duplicates.mjs and resolve them first. Counts only: names are user data.
-- SHARE MODE holds off writers from the check until the index exists, so an old-code insert
-- during a rolling deploy cannot slip a duplicate in between (its 23505 would log the name).
LOCK TABLE "tags" IN SHARE MODE;
--> statement-breakpoint
DO $$
DECLARE duplicate_groups integer; duplicate_tags integer;
BEGIN
  SELECT count(*), coalesce(sum(tags), 0) INTO duplicate_groups, duplicate_tags
    FROM (SELECT count(*) AS tags FROM "tags" GROUP BY "household_id", lower("name") HAVING count(*) > 1) AS groups;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION 'NEW-39: % household tag name group(s) (% tags) share a name in different case; run scripts/report-tag-duplicates.mjs and resolve them before this migration', duplicate_groups, duplicate_tags;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tags_household_name" ON "tags" USING btree ("household_id",lower("name"));
