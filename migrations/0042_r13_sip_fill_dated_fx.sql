-- #236 follow-up F1: a confirmed foreign SIP fill stores the ZMW base derived
-- from the dated rate for its execution date (the household's rate valid on
-- that date, else the provider rate on or before it), like any manual trade.
-- The three 0029 functions that pinned a SIP purchase's fx_rate/amount_zmw to
-- NULL now accept either that NULL pair (ZMW and every existing fill) or a
-- foreign pair whose amount_zmw is the amount at the stored rate, half-up to
-- the cent. The lot must carry the same pair, and the CREATE audit the same
-- values plus the dated-rate basis. The v2 fill digest already had fx slots;
-- they now carry the stored values. Replaces functions only: no table changes,
-- no existing row is refused, no backfill.
CREATE OR REPLACE FUNCTION public.c306_sip_fill_digest(purchase_uuid uuid, cadence public.recurring_frequency, initial_date date)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog, pg_temp AS $body$
  SELECT encode(sha256(convert_to(format(
    '[2,"record_only_sip_actual_fill",%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s]',
    to_json(p.account_id::text),to_json(p.security_id::text),to_json(p.quantity::text),to_json(p.price::text),
    to_json(p.fees::text),to_json(p.amount::text),to_json(p.currency::text),to_json(to_char(p.transaction_date,'YYYY-MM-DD')),
    to_json(cadence::text),to_json(to_char(initial_date,'YYYY-MM-DD')),
    coalesce(to_json(p.fx_rate::text)::text,'null'),coalesce(to_json(p.amount_zmw::text)::text,'null')),'UTF8')),'hex')
  FROM public.investment_transactions p WHERE p.id=purchase_uuid AND ((p.fx_rate IS NULL AND p.amount_zmw IS NULL) OR (p.currency<>'ZMW' AND p.fx_rate>0
        AND p.amount_zmw IS NOT NULL AND p.amount_zmw=round(p.amount*p.fx_rate,2)))
$body$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.c306_sip_fill_evidence(purchase_uuid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path=pg_catalog, pg_temp AS $body$
  SELECT EXISTS(SELECT 1 FROM public.investment_sip_confirmed_fills f
    JOIN public.investment_sip_confirmations c ON c.id=f.confirmation_id
    JOIN public.investment_sip_occurrences o ON o.plan_id=c.plan_id AND o.original_due_date=c.original_due_date
    JOIN public.investment_transactions p ON p.id=f.purchase_id
    JOIN public.holdings h ON h.id=p.holding_id AND h.household_id=o.household_id
      AND h.account_id=o.account_id AND h.security_id=o.security_id
    JOIN public.accounts custody ON custody.id=o.account_id AND custody.household_id=o.household_id
    WHERE p.id=purchase_uuid AND f.posting_confirmed AND p.type='buy'
      AND p.household_id=o.household_id AND p.account_id=o.account_id AND p.security_id=o.security_id
      AND p.currency=o.currency AND p.quantity=f.quantity AND p.price=f.price AND p.fees=f.fees
      AND p.amount=f.amount AND p.transaction_date=f.execution_date AND ((p.fx_rate IS NULL AND p.amount_zmw IS NULL) OR (p.currency<>'ZMW' AND p.fx_rate>0
        AND p.amount_zmw IS NOT NULL AND p.amount_zmw=round(p.amount*p.fx_rate,2)))
      AND p.linked_transaction_id IS NULL AND p.notes IS NULL AND coalesce(p.withholding_tax,0)=0
      AND (SELECT count(*) FROM public.tax_lots l WHERE l.transaction_id=p.id)=1
      AND EXISTS(SELECT 1 FROM public.tax_lots l WHERE l.transaction_id=p.id AND l.holding_id=p.holding_id
        AND l.household_id=p.household_id AND l.quantity=p.quantity AND l.cost_basis=p.amount
        AND l.remaining_quantity=l.quantity AND l.acquired_date=p.transaction_date
        AND l.cost_basis_zmw IS NOT DISTINCT FROM p.amount_zmw AND l.acquisition_fx_rate IS NOT DISTINCT FROM p.fx_rate)
      AND (SELECT count(*) FROM public.audit_logs a WHERE a.entity_id=p.id
        AND a.entity_type='investment_transaction' AND a.action='CREATE')=1
      AND EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.entity_id=p.id AND a.entity_type='investment_transaction'
        AND a.action='CREATE' AND a.user_id=c.actor_user_id AND a.ip_address IS NULL
        AND ((custody.is_private AND a.household_id IS NULL) OR (NOT custody.is_private AND a.household_id=o.household_id))
        AND a.details=jsonb_build_object('newValue',jsonb_build_object('type','buy','accountId',p.account_id::text,
          'holdingId',p.holding_id::text,'securityId',p.security_id::text,'quantity',p.quantity::text,'amount',p.amount::text,
          'currency',p.currency,'transactionDate',to_char(p.transaction_date,'YYYY-MM-DD'),'price',p.price::text,
          'fees',p.fees::text,'feesDeclared',true)
          || CASE WHEN p.fx_rate IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('fxRate',p.fx_rate::text,'amountZmw',p.amount_zmw::text) END)
          || CASE WHEN p.fx_rate IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('fxRateBasis','dated_household_then_provider_fx_v1') END))
$body$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.c306_guard_confirmed_fill() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.creation_xid:=pg_current_xact_id()::text;
    NEW.posting_confirmed:=false;
    IF NOT EXISTS(SELECT 1 FROM public.investment_transactions WHERE id=NEW.purchase_id)
      AND EXISTS(SELECT 1 FROM public.investment_sip_confirmations c WHERE c.id=NEW.confirmation_id
        AND public.investment_sip_owns_xid(c.xmin) AND NEW.fill_index<c.fill_count
        AND NEW.execution_date<=c.confirmation_cutoff_date) THEN RETURN NEW; END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF NOT OLD.posting_confirmed AND NEW.posting_confirmed AND OLD.creation_xid=pg_current_xact_id()::text
      AND (to_jsonb(OLD)-'posting_confirmed')=(to_jsonb(NEW)-'posting_confirmed')
      AND EXISTS(SELECT 1 FROM public.investment_transactions p
        JOIN public.investment_sip_confirmations c ON c.id=OLD.confirmation_id
        JOIN public.investment_sip_occurrences o ON o.plan_id=c.plan_id AND o.original_due_date=c.original_due_date
        WHERE p.id=OLD.purchase_id AND public.investment_sip_owns_xid(p.xmin) AND p.type='buy'
          AND p.household_id=o.household_id AND p.account_id=o.account_id AND p.security_id=o.security_id
          AND p.currency=o.currency AND p.quantity=OLD.quantity AND p.price=OLD.price AND p.fees=OLD.fees
          AND p.amount=OLD.amount AND p.transaction_date=OLD.execution_date
          AND ((p.fx_rate IS NULL AND p.amount_zmw IS NULL) OR (p.currency<>'ZMW' AND p.fx_rate>0
        AND p.amount_zmw IS NOT NULL AND p.amount_zmw=round(p.amount*p.fx_rate,2)))) THEN RETURN NEW; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.investment_transactions WHERE id=OLD.purchase_id)
      OR (NOT EXISTS(SELECT 1 FROM public.investment_sip_confirmations WHERE id=OLD.confirmation_id)
        AND EXISTS(SELECT 1 FROM public.investment_purchase_authorization_proofs WHERE purchase_id=OLD.purchase_id
          AND authorization_contract_version=2)) THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'Actual fill reservation is unavailable or immutable' USING ERRCODE='23514';
END
$body$;
