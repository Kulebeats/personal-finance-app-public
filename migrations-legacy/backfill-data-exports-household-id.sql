-- Backfill data_exports.household_id for users in a single household
-- Leaves multi-household users untouched for manual review

UPDATE data_exports de
SET household_id = hm.household_id
FROM household_members hm
WHERE de.household_id IS NULL
  AND de.user_id = hm.user_id
  AND NOT EXISTS (
    SELECT 1
    FROM household_members hm2
    WHERE hm2.user_id = de.user_id
      AND hm2.household_id <> hm.household_id
  );

SELECT 'Backfill complete. data_exports household_id updated where unambiguous.' AS status;
