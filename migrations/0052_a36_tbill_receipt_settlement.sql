-- 0052 (lane tax, A-36): a T-bill's principal returns to cash only when the
-- member confirms the bank credit. At maturity the bill becomes
-- awaiting_receipt and stays in net worth at face less the booked withholding;
-- the confirmed receipt posts the principal as asset_settlement cash exactly
-- once. Bills that matured under the old auto-post keep null columns and are
-- not rewritten (old data is out of scope).
-- The new enum value is only compared as text below, so it is safe inside the
-- migrator's transaction. The 0025/0033 binding and mutation guard are
-- extended with a T-bill branch; their bond rules are unchanged.
ALTER TYPE "public"."grz_security_status" ADD VALUE IF NOT EXISTS 'awaiting_receipt';--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD COLUMN "maturity_withholding_tax" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD COLUMN "maturity_net_proceeds" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD COLUMN "settlement_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD COLUMN "settlement_request_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD COLUMN "settlement_cash_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD COLUMN "settlement_receipt_date" date;--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD CONSTRAINT "grz_tbills_settlement_cash_tx_id_fk" FOREIGN KEY ("settlement_cash_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grz_tbills_settlement_operation" ON "grz_tbills" USING btree ("settlement_operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grz_tbills_settlement_cash" ON "grz_tbills" USING btree ("settlement_cash_transaction_id");--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD CONSTRAINT "chk_grz_tbills_maturity_terms" CHECK (("grz_tbills"."maturity_withholding_tax" IS NULL AND "grz_tbills"."maturity_net_proceeds" IS NULL AND "grz_tbills"."status"::text IS DISTINCT FROM 'awaiting_receipt')
    OR ("grz_tbills"."maturity_withholding_tax" IS NOT NULL AND "grz_tbills"."maturity_net_proceeds" IS NOT NULL
    AND "grz_tbills"."status"::text IN ('awaiting_receipt','matured') AND "grz_tbills"."maturity_withholding_tax">=0
    AND "grz_tbills"."maturity_withholding_tax"::text NOT IN ('NaN','Infinity','-Infinity')
    AND "grz_tbills"."maturity_net_proceeds"="grz_tbills"."face_value"-"grz_tbills"."maturity_withholding_tax"));--> statement-breakpoint
ALTER TABLE "grz_tbills" ADD CONSTRAINT "chk_grz_tbills_receipt_settlement" CHECK (("grz_tbills"."settlement_operation_id" IS NULL AND "grz_tbills"."settlement_request_digest" IS NULL
    AND "grz_tbills"."settlement_cash_transaction_id" IS NULL AND "grz_tbills"."settlement_receipt_date" IS NULL)
    OR ("grz_tbills"."settlement_operation_id" IS NOT NULL AND "grz_tbills"."settlement_request_digest" IS NOT NULL
    AND "grz_tbills"."settlement_cash_transaction_id" IS NOT NULL AND "grz_tbills"."settlement_receipt_date" IS NOT NULL
    AND "grz_tbills"."status"::text='matured' AND "grz_tbills"."maturity_net_proceeds" IS NOT NULL AND "grz_tbills"."maturity_investment_tx_id" IS NOT NULL
    AND "grz_tbills"."settlement_receipt_date">="grz_tbills"."maturity_date"));--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.check_grz_principal_settlement_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
DECLARE event public.grz_principal_settlements; valid boolean;
BEGIN
  IF TG_TABLE_NAME='transactions' THEN
    IF NEW.type::text<>'asset_settlement' THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM public.grz_bonds sb WHERE sb.sale_cash_transaction_id=NEW.id) THEN
      SELECT true INTO valid FROM public.grz_bonds sb
        JOIN public.transactions t ON t.id=sb.sale_cash_transaction_id
        JOIN public.accounts a ON a.id=t.account_id
        JOIN public.investment_transactions i ON i.linked_transaction_id=t.id AND i.type::text='sell'
      WHERE sb.sale_cash_transaction_id=NEW.id AND sb.status::text='sold'
        AND t.household_id=sb.household_id AND a.household_id=sb.household_id
        AND a.is_asset=true AND a.currency='ZMW' AND a.deleted_at IS NULL
        AND t.type::text='asset_settlement' AND t.currency='ZMW' AND t.amount=sb.sold_price-sb.sale_fees AND t.date=sb.sold_date
        AND t.deleted_at IS NULL AND t.is_pending=false AND t.status::text IS DISTINCT FROM 'pending'
        AND t.posting_mode='posted' AND t.posted_account_is_asset=true AND t.posted_balance_delta=t.amount
        AND i.household_id=sb.household_id AND i.account_id=t.account_id AND i.currency='ZMW'
        AND i.amount=sb.sold_price AND i.fees=sb.sale_fees AND i.withholding_tax=0 AND i.transaction_date=sb.sold_date
      FOR SHARE OF t,a;
      IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'Bond sale settlement binding is inconsistent' USING ERRCODE='23514'; END IF;
      RETURN NULL;
    END IF;
    -- A-36: a confirmed T-bill receipt. The cash is the principal (purchase
    -- price) on the confirmed date; the maturity row carries face less the
    -- booked withholding; any net interest is a separate income posting on the
    -- same account and date, so principal + net interest = face - withholding.
    IF EXISTS (SELECT 1 FROM public.grz_tbills tb WHERE tb.settlement_cash_transaction_id=NEW.id) THEN
      SELECT true INTO valid FROM public.grz_tbills tb
        JOIN public.transactions t ON t.id=tb.settlement_cash_transaction_id
        JOIN public.accounts a ON a.id=t.account_id
        JOIN public.investment_transactions i ON i.id=tb.maturity_investment_tx_id
      WHERE tb.settlement_cash_transaction_id=NEW.id AND tb.status::text='matured'
        AND tb.maturity_net_proceeds IS NOT NULL AND tb.maturity_withholding_tax IS NOT NULL
        AND tb.maturity_net_proceeds>=tb.purchase_price
        AND t.household_id=tb.household_id AND a.household_id=tb.household_id
        AND a.is_asset=true AND a.currency='ZMW' AND a.deleted_at IS NULL
        AND t.type::text='asset_settlement' AND t.currency='ZMW' AND t.amount=tb.purchase_price AND t.date=tb.settlement_receipt_date
        AND t.deleted_at IS NULL AND t.is_pending=false AND t.status::text IS DISTINCT FROM 'pending'
        AND t.posting_mode='posted' AND t.posted_account_is_asset=true AND t.posted_balance_delta=t.amount
        AND i.household_id=tb.household_id AND i.account_id=t.account_id AND i.type::text='maturity' AND i.currency='ZMW'
        AND i.amount=tb.maturity_net_proceeds AND i.withholding_tax=tb.maturity_withholding_tax AND i.linked_transaction_id=t.id
        AND ((tb.maturity_income_tx_id IS NULL AND tb.maturity_net_proceeds=tb.purchase_price)
          OR EXISTS (SELECT 1 FROM public.transactions income WHERE income.id=tb.maturity_income_tx_id
            AND income.household_id=tb.household_id AND income.account_id=t.account_id AND income.type::text='income'
            AND income.currency='ZMW' AND income.date=t.date AND income.deleted_at IS NULL
            AND income.amount=tb.maturity_net_proceeds-tb.purchase_price))
      FOR SHARE OF t,a;
      IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'T-bill receipt settlement binding is inconsistent' USING ERRCODE='23514'; END IF;
      RETURN NULL;
    END IF;
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
$body$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_grz_principal_cash_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
BEGIN
  IF EXISTS (SELECT 1 FROM public.grz_principal_settlements WHERE cash_transaction_id=OLD.id AND status='confirmed')
    OR EXISTS (SELECT 1 FROM public.grz_bonds WHERE sale_cash_transaction_id=OLD.id)
    OR EXISTS (SELECT 1 FROM public.grz_tbills WHERE settlement_cash_transaction_id=OLD.id) THEN
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
$body$;--> statement-breakpoint
