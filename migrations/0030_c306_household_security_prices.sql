-- C3-06 household-authored manual valuation prices (owner/admin writer, native
-- currency, both validity dates; the writer supplies the inclusive end date).
-- One household's price never values or executes anything in another household.
-- New storage and guards only: no backfill of prices from earlier versions.
CREATE TABLE public.household_security_price_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  security_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  effective_date date NOT NULL,
  valid_through date NOT NULL,
  price numeric NOT NULL,
  currency varchar(3) NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT household_security_price_override_household_fk
    FOREIGN KEY (household_id) REFERENCES public.households (id) ON DELETE CASCADE,
  -- Account erasure anonymizes this users row and removes the membership.
  -- The existing actor UUID remains attributable in a surviving household.
  CONSTRAINT household_security_price_override_actor_fk
    FOREIGN KEY (actor_user_id) REFERENCES public.users (id),
  CONSTRAINT household_security_price_override_security_fk
    FOREIGN KEY (security_id) REFERENCES public.securities (id),
  CONSTRAINT household_security_price_override_scope_date_key
    UNIQUE (household_id, security_id, effective_date),
  -- Untyped numeric preserves the input scale for checking. A manual price is
  -- strictly positive; the strict bounds also exclude NaN and both infinities.
  CONSTRAINT household_security_price_override_price_ck
    CHECK (price > 0 AND price < 100000000000 AND scale(price) <= 4),
  CONSTRAINT household_security_price_override_date_ck
    CHECK (effective_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
      AND valid_through BETWEEN effective_date AND DATE '9999-12-31'),
  CONSTRAINT household_security_price_override_currency_ck CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT household_security_price_override_source_ck CHECK (source = 'manual')
);

-- The signed writer will bind the actual actor and hold current household
-- authority through the write. Storage binds the immutable evidence to
-- existing roots and checks the instrument's native currency at creation.
--> statement-breakpoint
CREATE FUNCTION public.guard_household_security_price_override() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $body$
DECLARE
  native_currency text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'Recorded security price override cannot be changed in place' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  SELECT currency INTO native_currency
  FROM public.securities
  WHERE id = NEW.security_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Security price override requires an existing security' USING ERRCODE = '23503';
  END IF;
  IF NEW.currency IS DISTINCT FROM native_currency THEN
    RAISE EXCEPTION 'Security price override requires the native security currency' USING ERRCODE = '23514';
  END IF;

  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END
$body$;

--> statement-breakpoint
CREATE TRIGGER guard_household_security_price_override
BEFORE INSERT OR UPDATE ON public.household_security_price_overrides
FOR EACH ROW EXECUTE FUNCTION public.guard_household_security_price_override();

--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_household_security_price_override() FROM PUBLIC;
