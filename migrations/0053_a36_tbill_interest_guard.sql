-- Confirmed receipt interest is part of the cash credited for the same bill.
-- Guard its economics after initial settlement; old auto-posted links keep
-- their previous behavior. Erasure can remove the bill before deleting cash.
CREATE INDEX "idx_grz_tbills_confirmed_interest" ON "public"."grz_tbills" USING btree ("maturity_income_tx_id")
  WHERE settlement_operation_id IS NOT NULL;--> statement-breakpoint
CREATE FUNCTION public.guard_grz_tbill_interest_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(OLD.id,OLD.household_id,OLD.account_id,OLD.amount,OLD.currency,OLD.date,OLD.type,OLD.deleted_at,
      OLD.source,OLD.idempotency_key,OLD.is_pending,OLD.status,OLD.posted_balance_delta,OLD.posted_account_is_asset,OLD.posting_mode,
      OLD.category_id,OLD.merchant_id,OLD.is_excluded_from_reports,OLD.is_excluded_from_budget,
      OLD.transfer_account_id,OLD.transfer_transaction_id,OLD.is_transfer_in,OLD.is_balance_adjustment_increase)
      IS NOT DISTINCT FROM ROW(NEW.id,NEW.household_id,NEW.account_id,NEW.amount,NEW.currency,NEW.date,NEW.type,NEW.deleted_at,
      NEW.source,NEW.idempotency_key,NEW.is_pending,NEW.status,NEW.posted_balance_delta,NEW.posted_account_is_asset,NEW.posting_mode,
      NEW.category_id,NEW.merchant_id,NEW.is_excluded_from_reports,NEW.is_excluded_from_budget,
      NEW.transfer_account_id,NEW.transfer_transaction_id,NEW.is_transfer_in,NEW.is_balance_adjustment_increase) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.grz_tbills tb WHERE tb.maturity_income_tx_id=OLD.id
    AND tb.household_id=OLD.household_id AND tb.settlement_operation_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Confirmed T-bill interest is locked'
      USING ERRCODE='23514', CONSTRAINT='grz_tbill_interest_immutable';
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$body$;--> statement-breakpoint
CREATE TRIGGER grz_tbill_interest_immutable
  BEFORE UPDATE OF id,household_id,account_id,amount,currency,date,type,deleted_at,source,idempotency_key,
    is_pending,status,posted_balance_delta,posted_account_is_asset,posting_mode,category_id,merchant_id,
    is_excluded_from_reports,is_excluded_from_budget,transfer_account_id,transfer_transaction_id,is_transfer_in,is_balance_adjustment_increase
  OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_grz_tbill_interest_mutation();--> statement-breakpoint

-- Integrity triggers run under the migration owner so cash writers can use
-- their existing grants while the checks read settlement evidence. Keep the
-- trigger functions unavailable for callers to attach to other tables.
ALTER FUNCTION public.check_grz_principal_settlement_binding()
  SECURITY DEFINER SET search_path=pg_catalog, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.guard_grz_principal_cash_mutation()
  SECURITY DEFINER SET search_path=pg_catalog, pg_temp;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_grz_tbill_interest_mutation(), public.check_grz_principal_settlement_binding(),
  public.guard_grz_principal_cash_mutation() FROM PUBLIC;--> statement-breakpoint

-- These helpers also run inside deferred binding. Keep the same trusted type
-- resolution there while ordinary direct proof calls still use caller rights.
ALTER FUNCTION public.grz_principal_coupon_proof(uuid, uuid, date, uuid)
  SET search_path=pg_catalog, pg_temp;--> statement-breakpoint
ALTER FUNCTION public.grz_coupon_shift_months(date, integer)
  SET search_path=pg_catalog, pg_temp;
