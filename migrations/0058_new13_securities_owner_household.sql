ALTER TABLE "securities" ADD COLUMN "owner_household_id" uuid;--> statement-breakpoint
ALTER TABLE "securities" ADD CONSTRAINT "securities_owner_household_fk" FOREIGN KEY ("owner_household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_securities_owner_household" ON "securities" USING btree ("owner_household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_securities_custom_symbol" ON "securities" USING btree ("owner_household_id",upper("symbol")) WHERE "securities"."owner_household_id" IS NOT NULL;--> statement-breakpoint

-- NEW-13: a household's custom security (owner_household_id set) can be used
-- only by that household. Curated rows (owner NULL) stay usable by everyone.
-- Existing rows all start curated; nothing is backfilled.
CREATE FUNCTION public.guard_security_owner_household_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF NEW.security_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.securities s
    WHERE s.id=NEW.security_id AND s.owner_household_id IS NOT NULL
      AND s.owner_household_id IS DISTINCT FROM NEW.household_id) THEN
    RAISE EXCEPTION 'A custom security can only be used by the household that owns it'
      USING ERRCODE='23514', CONSTRAINT='security_owner_household_scope';
  END IF;
  RETURN NEW;
END
$body$;--> statement-breakpoint
CREATE TRIGGER holdings_security_owner_household_scope
  BEFORE INSERT OR UPDATE OF household_id,security_id ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION public.guard_security_owner_household_scope();--> statement-breakpoint
CREATE TRIGGER price_overrides_security_owner_household_scope
  BEFORE INSERT OR UPDATE OF household_id,security_id ON public.household_security_price_overrides
  FOR EACH ROW EXECUTE FUNCTION public.guard_security_owner_household_scope();--> statement-breakpoint
CREATE TRIGGER price_alerts_security_owner_household_scope
  BEFORE INSERT OR UPDATE OF household_id,security_id ON public.price_alerts
  FOR EACH ROW EXECUTE FUNCTION public.guard_security_owner_household_scope();--> statement-breakpoint
CREATE TRIGGER recurring_investments_security_owner_household_scope
  BEFORE INSERT OR UPDATE OF household_id,security_id ON public.recurring_investments
  FOR EACH ROW EXECUTE FUNCTION public.guard_security_owner_household_scope();--> statement-breakpoint
CREATE TRIGGER investment_transactions_security_owner_household_scope
  BEFORE INSERT OR UPDATE OF household_id,security_id ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_security_owner_household_scope();--> statement-breakpoint

-- A security's owner never changes, so a row the guard admitted stays admitted.
CREATE FUNCTION public.guard_security_owner_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF NEW.owner_household_id IS DISTINCT FROM OLD.owner_household_id THEN
    RAISE EXCEPTION 'A security''s owning household cannot change'
      USING ERRCODE='23514', CONSTRAINT='security_owner_household_scope';
  END IF;
  RETURN NEW;
END
$body$;--> statement-breakpoint
CREATE TRIGGER securities_owner_household_immutable
  BEFORE UPDATE OF owner_household_id ON public.securities
  FOR EACH ROW EXECUTE FUNCTION public.guard_security_owner_immutable();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_security_owner_household_scope(), public.guard_security_owner_immutable() FROM PUBLIC;
