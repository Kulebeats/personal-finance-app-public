-- Isolated fragment for coordinator composition into common 0025. Do not run
-- independently against a shared database. INSERT admission stays unchanged.
-- Updates (including recorder FK SET NULL) and TRUNCATE are always refused.
-- The existing true household erasure removes children before the parent: its
-- deferred deletion check therefore inspects the original household at COMMIT.
-- Neither a caller-set GUC nor trigger depth supplies erasure authority.
CREATE FUNCTION public.guard_grz_bond_valuation_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.households WHERE id=OLD.household_id) THEN
      RAISE EXCEPTION 'GRZ valuation evidence requires whole-household erasure' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'GRZ valuation evidence is immutable' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
-- Read the real parent under the migration owner's authority, not a caller's
-- row filter. Callers cannot attach this integrity function to another table.
REVOKE ALL ON FUNCTION public.guard_grz_bond_valuation_evidence() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER grz_bond_valuation_update_guard BEFORE UPDATE ON public.grz_bond_valuations
FOR EACH ROW EXECUTE FUNCTION public.guard_grz_bond_valuation_evidence();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grz_bond_valuation_delete_guard AFTER DELETE ON public.grz_bond_valuations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_grz_bond_valuation_evidence();
--> statement-breakpoint
CREATE TRIGGER grz_bond_valuation_truncate_guard BEFORE TRUNCATE ON public.grz_bond_valuations
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_grz_bond_valuation_evidence();
