-- R12 (NEW-13, exchange-rate half): manual exchange rates belong to the household
-- whose owner or admin recorded them, for an inclusive validity window. They never
-- enter the shared fx_rates table, so no other household can read or override them.
-- New storage and guards only: legacy fx_rates rows are not reassigned (no backfill).
CREATE TABLE public.household_fx_rate_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  from_currency varchar(3) NOT NULL,
  to_currency varchar(3) NOT NULL,
  effective_date date NOT NULL,
  valid_through date NOT NULL,
  rate numeric NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT household_fx_rate_override_household_fk
    FOREIGN KEY (household_id) REFERENCES public.households (id) ON DELETE CASCADE,
  -- Account erasure anonymizes this users row; the actor UUID stays attributable.
  CONSTRAINT household_fx_rate_override_actor_fk
    FOREIGN KEY (actor_user_id) REFERENCES public.users (id),
  CONSTRAINT household_fx_rate_override_scope_date_key
    UNIQUE (household_id, from_currency, to_currency, effective_date),
  -- Untyped numeric preserves the input scale for checking. A rate is strictly
  -- positive; the strict bounds also exclude NaN and both infinities.
  CONSTRAINT household_fx_rate_override_rate_ck
    CHECK (rate > 0 AND rate < 100000000000 AND scale(rate) <= 8),
  CONSTRAINT household_fx_rate_override_date_ck
    CHECK (effective_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
      AND valid_through BETWEEN effective_date AND DATE '9999-12-31'),
  CONSTRAINT household_fx_rate_override_pair_ck
    CHECK (from_currency ~ '^[A-Z]{3}$' AND to_currency ~ '^[A-Z]{3}$'
      AND from_currency <> to_currency),
  CONSTRAINT household_fx_rate_override_source_ck CHECK (source = 'manual')
);

-- A recorded rate is evidence: it cannot be changed in place, and storage stamps
-- its own recording time.
--> statement-breakpoint
CREATE FUNCTION public.guard_household_fx_rate_override() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Recorded exchange rate override cannot be changed in place' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END
$body$;

--> statement-breakpoint
CREATE TRIGGER guard_household_fx_rate_override
BEFORE INSERT OR UPDATE ON public.household_fx_rate_overrides
FOR EACH ROW EXECUTE FUNCTION public.guard_household_fx_rate_override();

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_household_fx_rate_override() FROM PUBLIC;
