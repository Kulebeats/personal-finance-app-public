-- R13.2 hardening (#221): a settled GRZ bond sale is ledger evidence. Once the
-- sale's cash is bound (sale_cash_transaction_id set, see 0033), the sale
-- fields cannot change and the bond row cannot be deleted while its household
-- or that cash survives. Rows without settled sale cash (active, matured,
-- legacy sold) are untouched: this adds no CHECK and rewrites no data.
-- If sale withholding is ever introduced, change 0033's i.withholding_tax=0
-- binding together with the gain formula in server/services/grz/bondSale.ts.
CREATE FUNCTION public.guard_grz_bond_sale_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
  IF OLD.sale_cash_transaction_id IS NOT NULL AND (
    NEW.status, NEW.sold_date, NEW.sold_price, NEW.sold_yield, NEW.sale_cash_transaction_id,
    NEW.sale_fees, NEW.sale_cost_basis, NEW.sale_realized_gain
  ) IS DISTINCT FROM (
    OLD.status, OLD.sold_date, OLD.sold_price, OLD.sold_yield, OLD.sale_cash_transaction_id,
    OLD.sale_fees, OLD.sale_cost_basis, OLD.sale_realized_gain
  ) THEN
    RAISE EXCEPTION 'A settled GRZ bond sale is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_grz_bond_sale_update() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER grz_bond_sale_update_guard BEFORE UPDATE ON public.grz_bonds
FOR EACH ROW EXECUTE FUNCTION public.guard_grz_bond_sale_update();
--> statement-breakpoint
-- Account erasure deletes the bond before its cash and the household, in one
-- transaction, so this check runs at COMMIT and inspects both parents then
-- (the 0025 principal-event rule). Neither a caller-set GUC nor trigger depth
-- supplies erasure authority. It reads the parents as the migration owner.
CREATE FUNCTION public.guard_grz_bond_sale_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
  IF OLD.sale_cash_transaction_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.households WHERE id=OLD.household_id)
    OR EXISTS (SELECT 1 FROM public.transactions WHERE id=OLD.sale_cash_transaction_id)
  ) THEN
    RAISE EXCEPTION 'A settled GRZ bond sale requires whole-household erasure' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END
$body$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_grz_bond_sale_delete() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grz_bond_sale_delete_guard AFTER DELETE ON public.grz_bonds
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_grz_bond_sale_delete();
