ALTER TABLE "net_worth_snapshots" ADD COLUMN "provenance" jsonb;
--> statement-breakpoint
CREATE FUNCTION r04_guard_snapshot_provenance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  capture jsonb := NEW.provenance;
  inventory jsonb := capture->'investmentInventory';
  source_name text;
BEGIN
  IF capture IS NULL THEN RETURN NEW; END IF;

  -- An older worker can replace the money fields without mentioning provenance.
  IF TG_OP = 'UPDATE' THEN
    IF capture->>'captureId' IS NOT DISTINCT FROM OLD.provenance->>'captureId' THEN
      NEW.provenance := NULL;
      RETURN NEW;
    END IF;
  END IF;

  IF (jsonb_typeof(capture) = 'object'
      AND capture->'version' = '1'::jsonb
      AND capture->>'captureId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND capture->>'householdId' = NEW.household_id::text
      AND capture->>'date' = to_char(NEW.date, 'YYYY-MM-DD')
      AND capture->>'currency' = NEW.currency AND NEW.currency ~ '^[A-Z]{3}$'
      AND capture->>'coverage' IN ('complete', 'unavailable')
      AND jsonb_typeof(inventory) = 'object'
      AND jsonb_typeof(capture->'omittedEligibleAccounts') = 'number'
      AND capture->>'omittedEligibleAccounts' ~ '^(0|[1-9][0-9]*)$'
      AND jsonb_typeof(capture->'contributions') = 'array'
      AND jsonb_typeof(NEW.account_balances) = 'array') IS NOT TRUE THEN
    NEW.provenance := NULL;
    RETURN NEW;
  END IF;

  FOREACH source_name IN ARRAY ARRAY['holdings','tbills','pensions','bonds'] LOOP
    IF (jsonb_typeof(inventory->source_name) = 'number'
        AND inventory->>source_name ~ '^(0|[1-9][0-9]*)$') IS NOT TRUE THEN
      NEW.provenance := NULL;
      RETURN NEW;
    END IF;
  END LOOP;

  -- The recipient reader additionally verifies amounts, denomination and audience.
  IF (capture->'investmentsAbsent' = to_jsonb(inventory = '{"holdings":0,"tbills":0,"pensions":0,"bonds":0}'::jsonb)
      AND (capture->>'coverage' = 'unavailable' OR
           (capture->'investmentsAbsent' = 'true'::jsonb AND capture->'omittedEligibleAccounts' = '0'::jsonb))
      AND jsonb_array_length(capture->'contributions') = jsonb_array_length(NEW.account_balances)) IS NOT TRUE THEN
    NEW.provenance := NULL;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER r04_snapshot_provenance_guard
BEFORE INSERT OR UPDATE ON net_worth_snapshots
FOR EACH ROW EXECUTE FUNCTION r04_guard_snapshot_provenance();
