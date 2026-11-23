CREATE TABLE "account_worth_capture_days" (
	"household_id" uuid NOT NULL,
	"date" date NOT NULL,
	"write_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	CONSTRAINT "chk_account_worth_capture_day" CHECK (isfinite("account_worth_capture_days"."date"))
);
--> statement-breakpoint
CREATE TABLE "account_worth_capture_generations" (
	"capture_id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_worth_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"date" date NOT NULL,
	"capture_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"currency" varchar(3),
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_account_worth_capture_header" CHECK (
    isfinite("account_worth_captures"."date") AND isfinite("account_worth_captures"."captured_at")
    AND isfinite("account_worth_captures"."created_at") AND isfinite("account_worth_captures"."updated_at")
    AND ("account_worth_captures"."currency" IS NULL OR "account_worth_captures"."currency" ~ '^[A-Z]{3}$')
  )
);
--> statement-breakpoint
ALTER TABLE "account_worth_capture_days" ADD CONSTRAINT "account_worth_capture_days_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_worth_captures" ADD CONSTRAINT "account_worth_captures_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_account_worth_capture_days_household_date" ON "account_worth_capture_days" USING btree ("household_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_account_worth_captures_household_date" ON "account_worth_captures" USING btree ("household_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_account_worth_captures_generation" ON "account_worth_captures" USING btree ("capture_id");
--> statement-breakpoint
-- No backfill: neither an old aggregate nor an imported balance attests these facts.
-- Native amounts only. Readers must separately prove current audience and coverage.
CREATE FUNCTION public.r04_account_capture_records(target_household uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'accountId', a.id::text,
    'accountType', a.type::text,
    'sourceAmount', CASE WHEN a.source_amount::text NOT IN ('NaN', 'Infinity', '-Infinity') THEN a.source_amount::text END,
    'sourceCurrency', CASE WHEN a.currency ~ '^[A-Z]{3}$' THEN a.currency END,
    'excluded', a.exclude_from_net_worth,
    'hidden', a.is_hidden,
    'archived', a.is_archived,
    'deleted', a.deleted_at IS NOT NULL,
    'investments', jsonb_build_object(
      'holdings', (SELECT count(*) FROM public.holdings h
        WHERE h.household_id = a.household_id AND h.account_id = a.id AND h.quantity IS DISTINCT FROM 0),
      'tbills', (SELECT count(*) FROM public.grz_tbills t
        WHERE t.household_id = a.household_id AND t.account_id = a.id
          AND (t.status = 'active' OR t.status IS NULL) AND t.face_value IS DISTINCT FROM 0),
      'pensions', (SELECT count(*) FROM public.pension_holdings p
        WHERE p.household_id = a.household_id AND p.account_id = a.id AND p.current_balance IS DISTINCT FROM 0),
      'bonds', (SELECT count(*) FROM public.grz_bonds b
        WHERE b.household_id = a.household_id AND b.account_id = a.id
          AND (b.status = 'active' OR b.status IS NULL) AND b.face_value IS DISTINCT FROM 0)
    )
  ) ORDER BY a.id), '[]'::jsonb)
  FROM (
    SELECT accounts.*, CASE WHEN type IN ('real_estate', 'vehicle') AND estimated_value IS NOT NULL
      THEN estimated_value ELSE balance END AS source_amount
    FROM public.accounts WHERE household_id = target_household
  ) a;
$$;
--> statement-breakpoint
-- A real MVCC write fences legacy writers even when the scoped receipt is absent
-- or already withdrawn. Under READ COMMITTED a waiter subsequently invalidates
-- the newly committed proof; under REPEATABLE READ/SERIALIZABLE it must retry.
CREATE FUNCTION public.r04_touch_account_capture_day(target_household uuid, target_date date) RETURNS void
LANGUAGE plpgsql STRICT SET search_path = pg_catalog AS $$
BEGIN
  -- A household cascade already removes all identifying receipt/day rows.
  IF NOT isfinite(target_date) OR NOT EXISTS (SELECT 1 FROM public.households WHERE id = target_household) THEN
    RETURN;
  END IF;
  INSERT INTO public.account_worth_capture_days(household_id, date, write_id)
    VALUES (target_household, target_date, gen_random_uuid())
    ON CONFLICT (household_id, date) DO UPDATE SET write_id = gen_random_uuid();
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.r04_guard_account_capture() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  facts jsonb;
  base_currency text;
  observed_at timestamptz;
  database_instant timestamptz := date_trunc('milliseconds', transaction_timestamp());
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.r04_touch_account_capture_day(OLD.household_id, OLD.date);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.household_id IS DISTINCT FROM OLD.household_id
        OR NEW.date IS DISTINCT FROM OLD.date OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Account capture identity is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  -- NULL is withdrawal, never a placeholder or an alternate authoring path.
  IF NEW.evidence IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Account capture requires verified evidence' USING ERRCODE = '23514';
    END IF;
    IF NEW.capture_id IS DISTINCT FROM OLD.capture_id OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
        OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'Account capture withdrawal must preserve its header' USING ERRCODE = '23514';
    END IF;
    PERFORM public.r04_touch_account_capture_day(NEW.household_id, NEW.date);
    RETURN NEW;
  END IF;

  PERFORM public.r04_touch_account_capture_day(NEW.household_id, NEW.date);
  -- Stable across midnight and roundtrips exactly through node-pg's JS Date.
  -- Only the observed transaction-start day may receive a new proof; old rows
  -- remain readable but can never be re-attested from today's account balances.
  IF NEW.captured_at IS DISTINCT FROM database_instant
      OR NEW.date IS DISTINCT FROM (database_instant AT TIME ZONE 'UTC')::date
      OR NEW.date IS DISTINCT FROM (NEW.captured_at AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Account capture requires the current database UTC day and instant' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.capture_id IS NOT DISTINCT FROM OLD.capture_id THEN
      RAISE EXCEPTION 'Account capture requires a fresh generation' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.account_worth_capture_generations WHERE capture_id = NEW.capture_id) THEN
    RAISE EXCEPTION 'Account capture generation has already been used' USING ERRCODE = '23514';
  END IF;

  -- Both reads share this one statement snapshot. The producer also uses SERIALIZABLE.
  SELECT public.r04_account_capture_records(h.id), CASE WHEN h.currency ~ '^[A-Z]{3}$' THEN h.currency END
    INTO facts, base_currency FROM public.households h WHERE h.id = NEW.household_id;
  IF facts IS NULL OR NEW.currency IS DISTINCT FROM base_currency THEN
    RAISE EXCEPTION 'Account capture denomination does not match observed household' USING ERRCODE = '23514';
  END IF;
  IF (jsonb_typeof(NEW.evidence->'capturedAt') = 'string'
      AND NEW.evidence->>'capturedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$') IS NOT TRUE THEN
    RAISE EXCEPTION 'Account capture requires an explicit captured instant' USING ERRCODE = '23514';
  END IF;
  BEGIN
    observed_at := (NEW.evidence->>'capturedAt')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Account capture instant is invalid' USING ERRCODE = '23514';
  END;
  IF (observed_at = NEW.captured_at AND isfinite(observed_at)) IS NOT TRUE
      OR NEW.evidence IS DISTINCT FROM jsonb_build_object(
        'version', 1, 'captureId', NEW.capture_id::text, 'householdId', NEW.household_id::text,
        'date', to_char(NEW.date, 'YYYY-MM-DD'), 'currency', NEW.currency,
        'capturedAt', NEW.evidence->>'capturedAt', 'inventoryComplete', true,
        'capturedAccountCount', jsonb_array_length(facts), 'accounts', facts
      ) THEN
    RAISE EXCEPTION 'Account capture does not match exhaustive observed facts' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER r04_account_capture_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.account_worth_captures
FOR EACH ROW EXECUTE FUNCTION public.r04_guard_account_capture();
--> statement-breakpoint
-- AFTER avoids spending a generation twice during INSERT ... ON CONFLICT DO UPDATE.
-- The registry's primary key also arbitrates competing uses in different transactions.
CREATE FUNCTION public.r04_register_account_capture_generation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.evidence IS NOT NULL THEN
    INSERT INTO public.account_worth_capture_generations(capture_id) VALUES (NEW.capture_id);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER r04_account_capture_generation
AFTER INSERT OR UPDATE ON public.account_worth_captures
FOR EACH ROW EXECUTE FUNCTION public.r04_register_account_capture_generation();
--> statement-breakpoint
-- Spent IDs outlive household deletion without retaining identifying facts.
CREATE FUNCTION public.r04_protect_account_capture_generations() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Spent account capture generations are immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER r04_account_capture_generations_immutable
BEFORE UPDATE OR DELETE ON public.account_worth_capture_generations
FOR EACH ROW EXECUTE FUNCTION public.r04_protect_account_capture_generations();
--> statement-breakpoint
CREATE TRIGGER r04_account_capture_generations_no_truncate
BEFORE TRUNCATE ON public.account_worth_capture_generations
FOR EACH STATEMENT EXECUTE FUNCTION public.r04_protect_account_capture_generations();
--> statement-breakpoint
CREATE FUNCTION public.r04_invalidate_account_capture() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  old_household uuid;
  old_date date;
  new_household uuid;
  new_date date;
  capture_day record;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_household := OLD.household_id;
    old_date := OLD.date;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_household := NEW.household_id;
    new_date := NEW.date;
  END IF;
  FOR capture_day IN
    SELECT DISTINCT household_id, date FROM (VALUES (old_household, old_date), (new_household, new_date)) AS days(household_id, date)
      WHERE household_id IS NOT NULL AND date IS NOT NULL ORDER BY household_id, date
  LOOP
    PERFORM public.r04_touch_account_capture_day(capture_day.household_id, capture_day.date);
    UPDATE public.account_worth_captures SET evidence = NULL, updated_at = statement_timestamp()
      WHERE household_id = capture_day.household_id AND date = capture_day.date AND evidence IS NOT NULL;
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- Every legacy aggregate write invalidates the prior receipt, even a no-op or
-- same-ID rewrite. The new producer writes its fresh independent receipt LAST.
-- Independent account_balance_snapshots imports are deliberately unaffected.
CREATE TRIGGER r04_legacy_snapshot_invalidates_account_capture
AFTER INSERT OR UPDATE OR DELETE ON public.net_worth_snapshots
FOR EACH ROW EXECUTE FUNCTION public.r04_invalidate_account_capture();
