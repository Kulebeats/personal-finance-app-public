-- Migrate legacy rule conditions from "field" to "type"
--
-- Legacy schema used: { field: "merchant" | "amount" | ... }
-- New schema uses: { type: "merchant_name" | "amount" | ... }
--
-- Mapping:
-- - merchant -> merchant_name
-- - amount -> amount
-- - description -> description
-- - category -> category
-- - account -> account
-- - date -> description (no direct date condition type exists in current engine)
--
-- This preserves order and only transforms conditions that are missing "type".

UPDATE rules
SET conditions = (
  SELECT jsonb_agg(
           CASE
             WHEN cond ? 'type' THEN cond
             WHEN cond ? 'field' THEN jsonb_set(
               cond - 'field',
               '{type}',
               to_jsonb(
                 CASE cond->>'field'
                   WHEN 'merchant' THEN 'merchant_name'
                   WHEN 'date' THEN 'description'
                   ELSE cond->>'field'
                 END
               ),
               true
             )
             ELSE cond
           END
           ORDER BY ordinality
         )
  FROM jsonb_array_elements(rules.conditions) WITH ORDINALITY AS cond( cond, ordinality )
)
WHERE conditions IS NOT NULL;
