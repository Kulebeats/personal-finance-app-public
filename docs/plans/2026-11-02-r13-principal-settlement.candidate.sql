-- ISOLATED CANDIDATE. Main composes common 0025 after 0024; no journal entry.
-- Create grz_bond_valuations and grz_bond_principal_basis first. Do not use the new enum value in DML until
-- the enum append has committed. Existing ambiguous rows are not backfilled.
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'asset_settlement';
CREATE TABLE grz_principal_settlements (
  operation_id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  bond_id uuid NOT NULL REFERENCES grz_bonds(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES grz_bond_payments(id) ON DELETE CASCADE,
  destination_account_id uuid NOT NULL REFERENCES accounts(id),
  requested_receipt_id uuid REFERENCES transactions(id),
  cash_transaction_id uuid REFERENCES transactions(id),
  investment_transaction_id uuid REFERENCES investment_transactions(id),
  receipt_date date NOT NULL,
  request_digest varchar(64) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  currency varchar(3) NOT NULL,
  principal_amount numeric(15,2) NOT NULL,
  received_amount numeric(15,2) NOT NULL,
  cost_basis numeric(15,2),
  realized_basis_difference numeric(15,2),
  purchased_interest numeric(15,2), acquisition_fees numeric(15,2),
  basis_id uuid REFERENCES grz_bond_principal_basis(id), basis_evidence jsonb,
  fees numeric(15,2) NOT NULL,
  valuation_id uuid REFERENCES grz_bond_valuations(id),
  valuation jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CONSTRAINT chk_grz_principal_state CHECK (
    status IN ('pending','confirmed') AND currency='ZMW'
    AND received_amount>0 AND fees>=0
    AND principal_amount=received_amount+fees
    AND principal_amount::text NOT IN ('NaN','Infinity','-Infinity')
    AND received_amount::text NOT IN ('NaN','Infinity','-Infinity')
    AND fees::text NOT IN ('NaN','Infinity','-Infinity')
    AND ((basis_id IS NULL AND cost_basis IS NULL AND realized_basis_difference IS NULL AND purchased_interest IS NULL AND acquisition_fees IS NULL AND basis_evidence IS NULL)
      OR (basis_id IS NOT NULL AND cost_basis IS NOT NULL AND realized_basis_difference IS NOT NULL AND purchased_interest IS NOT NULL AND acquisition_fees IS NOT NULL
        AND cost_basis>0 AND purchased_interest>=0 AND acquisition_fees>=0 AND basis_evidence IS NOT NULL
        AND cost_basis::text NOT IN ('NaN','Infinity','-Infinity') AND purchased_interest::text NOT IN ('NaN','Infinity','-Infinity')
        AND acquisition_fees::text NOT IN ('NaN','Infinity','-Infinity') AND realized_basis_difference=principal_amount-cost_basis))
    AND ((status='pending' AND cash_transaction_id IS NULL AND investment_transaction_id IS NULL AND confirmed_at IS NULL AND valuation_id IS NULL AND valuation IS NULL)
      OR (status='confirmed' AND cash_transaction_id IS NOT NULL AND investment_transaction_id IS NOT NULL
        AND basis_id IS NOT NULL AND valuation_id IS NOT NULL AND valuation IS NOT NULL AND confirmed_at IS NOT NULL)))
);
CREATE UNIQUE INDEX uq_grz_principal_confirmed_payment ON grz_principal_settlements(payment_id) WHERE status='confirmed';
CREATE UNIQUE INDEX uq_grz_principal_confirmed_bond ON grz_principal_settlements(bond_id) WHERE status='confirmed';
CREATE UNIQUE INDEX uq_grz_principal_cash_receipt ON grz_principal_settlements(cash_transaction_id);
CREATE UNIQUE INDEX uq_grz_principal_investment ON grz_principal_settlements(investment_transaction_id);

CREATE FUNCTION public.check_grz_principal_settlement_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
DECLARE event public.grz_principal_settlements; valid boolean;
BEGIN
  IF TG_TABLE_NAME='transactions' THEN
    IF NEW.type::text<>'asset_settlement' THEN RETURN NULL; END IF;
    SELECT * INTO event FROM public.grz_principal_settlements WHERE cash_transaction_id=NEW.id AND status='confirmed';
    IF NOT FOUND THEN RAISE EXCEPTION 'Asset settlement requires its confirmed instrument event' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT * INTO event FROM public.grz_principal_settlements WHERE operation_id=NEW.operation_id;
    IF NOT FOUND OR event.status<>'confirmed' THEN RETURN NULL; END IF;
  END IF;
  SELECT true INTO valid FROM public.grz_bonds b
    JOIN public.grz_bond_payments p ON p.bond_id=b.id
    JOIN public.transactions t ON t.id=event.cash_transaction_id
    JOIN public.accounts a ON a.id=t.account_id
    JOIN public.investment_transactions i ON i.id=event.investment_transaction_id
    JOIN public.grz_bond_valuations v ON v.id=event.valuation_id
    JOIN public.grz_bond_principal_basis basis ON basis.id=event.basis_id
  WHERE b.id=event.bond_id AND p.id=event.payment_id AND b.household_id=event.household_id
    AND b.status::text='matured' AND p.status::text='paid' AND p.payment_type='principal'
    AND p.income_transaction_id IS NULL AND p.investment_transaction_id=i.id
    AND p.actual_payment_date=event.receipt_date AND p.payment_date=b.maturity_date
    AND p.gross_amount=event.principal_amount AND p.net_amount=event.principal_amount AND p.withholding_tax=0
    AND b.face_value=event.principal_amount
    AND basis.household_id=event.household_id AND basis.bond_id=b.id AND basis.account_id=b.account_id
    AND basis.authority='member_recorded' AND basis.isin=b.isin AND basis.nominal_amount=b.face_value AND basis.currency=event.currency
    AND basis.acquisition_date=b.purchase_date AND basis.purchase_cash_amount=b.purchase_price
    AND event.cost_basis=basis.principal_cost AND event.purchased_interest=basis.purchased_interest AND event.acquisition_fees=basis.acquisition_fees
    AND event.basis_evidence->>'sourceId'=basis.id::text AND event.basis_evidence->>'sourceKind'=basis.source_kind
    AND event.basis_evidence->>'sourceDate'=basis.source_date::text AND event.basis_evidence->>'acquisitionDate'=basis.acquisition_date::text
    AND event.basis_evidence->>'purchaseCashAmount'=basis.purchase_cash_amount::text AND event.basis_evidence->>'policyVersion'=basis.policy_version
    AND t.household_id=event.household_id AND t.account_id=event.destination_account_id AND a.household_id=event.household_id
    AND a.is_asset=true AND a.currency=event.currency
    AND a.deleted_at IS NULL AND (a.is_private=false OR a.owner_user_id=event.actor_user_id)
    AND (t.is_private=false OR t.owner_user_id=event.actor_user_id)
    AND (event.requested_receipt_id IS NULL OR event.requested_receipt_id=t.id)
    AND NOT EXISTS(SELECT 1 FROM public.grz_bond_payments reserved WHERE reserved.income_transaction_id=t.id)
    AND NOT EXISTS(SELECT 1 FROM public.transaction_create_owner_intents origin WHERE origin.transaction_id=t.id AND origin.operation='grz_coupon')
    AND t.type::text='asset_settlement' AND t.currency=event.currency AND t.amount=event.received_amount AND t.date=event.receipt_date
    AND t.deleted_at IS NULL AND t.is_pending=false AND t.status::text IS DISTINCT FROM 'pending'
    AND t.posting_mode='posted' AND t.posted_account_is_asset=true
    AND t.posted_balance_delta=event.received_amount
    AND i.household_id=event.household_id AND i.account_id=event.destination_account_id AND i.type::text='maturity'
    AND i.amount=event.principal_amount AND i.currency=event.currency AND i.fees=event.fees AND i.withholding_tax=0
    AND i.transaction_date=event.receipt_date AND i.linked_transaction_id=t.id
    AND v.household_id=event.household_id AND v.bond_id=b.id AND v.account_id=b.account_id
    AND v.isin=b.isin AND v.nominal_amount=b.face_value AND v.currency=event.currency
    AND v.clean_value IS NOT NULL AND v.accrued_value>=0 AND v.dirty_value=v.clean_value+v.accrued_value AND v.valuation_date=b.maturity_date
    AND event.receipt_date>=b.maturity_date AND event.receipt_date<=(transaction_timestamp() at time zone 'UTC')::date
    AND event.valuation->'couponReconciliation'=public.grz_principal_coupon_proof(b.id,v.id,event.receipt_date,event.actor_user_id)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(event.valuation->'couponReconciliation'->'payments') cp
      WHERE cp->>'receiptTransactionId'=event.cash_transaction_id::text)
    AND event.valuation->>'component'='ex_coupon_principal' AND event.valuation->>'sourceId'=v.id::text
    AND event.valuation->>'sourceKind'=v.source_kind AND event.valuation->>'policyVersion'=v.policy_version
    AND event.valuation->>'asOfDate'=v.valuation_date::text AND event.valuation->>'currency'=event.currency
    AND event.valuation->>'amount'=v.clean_value::text
    AND event.valuation->>'includedCouponAmount'=v.accrued_value::text
    AND event.valuation->>'settlementValueDifference'=(event.received_amount-v.clean_value)::text
    FOR SHARE OF t,a;
  IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'Principal settlement binding is inconsistent' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END
$body$;
CREATE CONSTRAINT TRIGGER grz_principal_event_binding AFTER INSERT OR UPDATE ON grz_principal_settlements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_grz_principal_settlement_binding();
CREATE CONSTRAINT TRIGGER grz_principal_cash_binding AFTER INSERT OR UPDATE ON transactions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_grz_principal_settlement_binding();

CREATE FUNCTION public.guard_grz_principal_cash_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
  IF EXISTS (SELECT 1 FROM public.grz_principal_settlements WHERE cash_transaction_id=OLD.id AND status='confirmed') THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Principal settlement cash requires an adjustment' USING ERRCODE='23514'; END IF;
    IF ROW(OLD.household_id,OLD.account_id,OLD.amount,OLD.currency,OLD.date,OLD.type,OLD.deleted_at,OLD.is_pending,OLD.status,
      OLD.posted_balance_delta,OLD.posted_account_is_asset,OLD.posting_mode)
      IS DISTINCT FROM ROW(NEW.household_id,NEW.account_id,NEW.amount,NEW.currency,NEW.date,NEW.type,NEW.deleted_at,NEW.is_pending,NEW.status,
      NEW.posted_balance_delta,NEW.posted_account_is_asset,NEW.posting_mode) THEN
      RAISE EXCEPTION 'Principal settlement cash requires an adjustment' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$body$;
CREATE TRIGGER grz_principal_cash_mutation_guard BEFORE UPDATE OR DELETE ON transactions
FOR EACH ROW WHEN (OLD.type::text='asset_settlement') EXECUTE FUNCTION public.guard_grz_principal_cash_mutation();

CREATE FUNCTION public.guard_grz_principal_event_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
  IF OLD.status='confirmed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Confirmed principal event is immutable' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.operation_id,NEW.household_id,NEW.actor_user_id,NEW.bond_id,NEW.payment_id,NEW.destination_account_id,NEW.requested_receipt_id,
    NEW.receipt_date,NEW.request_digest,NEW.currency,NEW.principal_amount,NEW.received_amount,NEW.fees)
    IS DISTINCT FROM ROW(OLD.operation_id,OLD.household_id,OLD.actor_user_id,OLD.bond_id,OLD.payment_id,OLD.destination_account_id,OLD.requested_receipt_id,
    OLD.receipt_date,OLD.request_digest,OLD.currency,OLD.principal_amount,OLD.received_amount,OLD.fees) THEN
    RAISE EXCEPTION 'Principal operation intent is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.basis_id IS NOT NULL AND ROW(NEW.basis_id,NEW.cost_basis,NEW.realized_basis_difference,NEW.purchased_interest,NEW.acquisition_fees,NEW.basis_evidence)
    IS DISTINCT FROM ROW(OLD.basis_id,OLD.cost_basis,OLD.realized_basis_difference,OLD.purchased_interest,OLD.acquisition_fees,OLD.basis_evidence) THEN
    RAISE EXCEPTION 'Confirmed acquisition evidence changed; start a fresh principal confirmation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$body$;
CREATE TRIGGER grz_principal_event_update_guard BEFORE UPDATE ON grz_principal_settlements
FOR EACH ROW EXECUTE FUNCTION public.guard_grz_principal_event_update();

-- Deleting the receipt or parent payment cannot remove the once-only financial
-- evidence. A complete household erasure may remove children first, provided
-- the original household AND cash are absent at this transaction's commit.
CREATE FUNCTION public.guard_grz_principal_event_delete() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
  IF OLD.status='confirmed' AND (
    EXISTS (SELECT 1 FROM public.households WHERE id=OLD.household_id)
    OR EXISTS (SELECT 1 FROM public.transactions WHERE id=OLD.cash_transaction_id)
  ) THEN
    RAISE EXCEPTION 'Confirmed principal evidence requires whole-household erasure' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END
$body$;
CREATE CONSTRAINT TRIGGER grz_principal_event_delete_guard AFTER DELETE ON grz_principal_settlements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_grz_principal_event_delete();
