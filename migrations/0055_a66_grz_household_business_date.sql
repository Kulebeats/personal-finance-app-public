-- A-66: application checks and database proof share the transaction's
-- household business day. Unconfigured legacy households keep UTC.
-- The invoker must already be allowed to read the household.
CREATE FUNCTION public.grz_household_business_date(target_household uuid) RETURNS date
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $body$
  SELECT CASE
    WHEN h.time_zone IS NULL THEN (transaction_timestamp() AT TIME ZONE 'UTC')::date
    WHEN h.time_zone ~ '^[A-Za-z][A-Za-z0-9_./+-]*$' AND h.time_zone !~* '^(UTC|GMT)[+-]'
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names tz WHERE tz.name=h.time_zone)
    THEN (transaction_timestamp() AT TIME ZONE h.time_zone)::date
  END
  FROM public.households h WHERE h.id=target_household
$body$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.guard_grz_principal_basis_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE cut_date date;
BEGIN
  PERFORM 1 FROM public.households WHERE id=NEW.household_id FOR SHARE;
  IF NOT FOUND OR NEW.recorded_by IS NULL THEN
    RAISE EXCEPTION 'Principal basis requires an attributable recorder' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.household_members WHERE household_id=NEW.household_id AND user_id=NEW.recorded_by
    AND role::text IN ('owner','admin','member') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Principal basis requires an attributable recorder' USING ERRCODE='23514'; END IF;
  -- Match the service order: household -> grant -> bond -> custody -> user.
  -- Foreign-key key-share alone does not fence a concurrent non-key change
  -- to holding status, account privacy, denomination or asset classification.
  PERFORM 1 FROM public.grz_bonds WHERE id=NEW.bond_id AND household_id=NEW.household_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Principal basis requires an attributable ZMW asset holding' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.accounts WHERE id=NEW.account_id AND household_id=NEW.household_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Principal basis requires an attributable ZMW asset holding' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM public.users WHERE id=NEW.recorded_by AND erased_at IS NULL AND email_verified=true FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Principal basis requires an attributable recorder' USING ERRCODE='23514'; END IF;
  cut_date := public.grz_household_business_date(NEW.household_id);
  IF cut_date IS NULL OR NEW.source_date>cut_date OR NEW.policy_version<>'grz_member_recorded_principal_basis_v1' THEN
    RAISE EXCEPTION 'Principal basis requires a supported dated source' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public.grz_bonds b JOIN public.accounts a ON a.id=b.account_id
    WHERE b.id=NEW.bond_id AND b.household_id=NEW.household_id AND a.id=NEW.account_id AND a.household_id=NEW.household_id
      AND b.status::text='active' AND b.isin=NEW.isin AND b.face_value=NEW.nominal_amount AND b.purchase_date=NEW.acquisition_date
      AND b.purchase_price=NEW.purchase_cash_amount AND a.currency='ZMW' AND a.is_asset=true AND a.deleted_at IS NULL
      AND (a.is_private=false OR a.owner_user_id=NEW.recorded_by);
  IF NOT FOUND THEN RAISE EXCEPTION 'Principal basis requires an attributable ZMW asset holding' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END
$body$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.grz_principal_coupon_proof(bond_id uuid, valuation_id uuid, receipt_date date, actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $body$
DECLARE
  b public.grz_bonds; v public.grz_bond_valuations; p public.grz_bond_payments; cash public.transactions;
  captured jsonb; proof jsonb := '[]'::jsonb; dates date[] := ARRAY[]::date[];
  boundary date; expected date; months integer; step integer; periods integer; start_index integer;
  use_maturity boolean; row_count integer; i integer; original_count integer; original_matches integer;
  period_value numeric; expected_gross numeric; expected_tax numeric; expected_net numeric;
  raw_holding numeric; raw_accrued numeric; raw_dirty numeric; raw_clean numeric;
  included_unpaid numeric := 0; included_count integer := 0;
  captured_household uuid;
  cut_date date;
BEGIN
  SELECT * INTO b FROM public.grz_bonds WHERE id=bond_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  captured_household := b.household_id;
  PERFORM 1 FROM public.households WHERE id=captured_household FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.household_members m WHERE m.household_id=captured_household AND m.user_id=actor_id
    AND m.role::text IN ('owner','admin','member') FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  cut_date := public.grz_household_business_date(captured_household);
  IF cut_date IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO b FROM public.grz_bonds WHERE id=bond_id AND household_id=captured_household FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT q.* INTO v FROM public.grz_bond_valuations q WHERE q.id=valuation_id AND q.bond_id=b.id FOR SHARE;
  IF NOT FOUND OR v.valuation_date<>b.maturity_date OR v.source_date<>b.maturity_date
    OR receipt_date<b.maturity_date OR receipt_date>cut_date
    OR b.coupon_rate IS NULL OR b.coupon_rate::text !~ '^[0-9]+([.][0-9]+)?$' OR b.coupon_rate<0 OR b.coupon_rate>1
    OR jsonb_typeof(v.coupon_state)<>'array' THEN RETURN NULL; END IF;
  -- Match the ordinary exact-date selector: an inadmissible newest revision
  -- makes the component unavailable; older evidence is never substituted.
  IF v.id IS DISTINCT FROM (SELECT q.id FROM public.grz_bond_valuations q WHERE q.bond_id=b.id
      AND q.valuation_date=b.maturity_date ORDER BY q.sequence DESC LIMIT 1)
    OR v.household_id<>b.household_id OR v.account_id IS DISTINCT FROM b.account_id OR v.isin IS DISTINCT FROM b.isin
    OR v.nominal_amount<>b.face_value OR v.currency<>'ZMW' OR v.authority<>'member_recorded'
    OR v.policy_version<>'grz_member_recorded_market_v1'
    OR v.source_kind NOT IN ('custodian_statement','same_issue_quote','same_issue_trade') OR v.source_reference !~ '[^[:space:]]'
    OR v.recorded_by IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=v.recorded_by)
    OR v.quote_basis NOT IN ('clean','dirty') OR v.quote_units NOT IN ('holding_amount','per_100_nominal')
    OR v.quoted_amount::text !~ '^[0-9]{1,13}([.][0-9]{1,8})?$' OR v.quoted_amount<=0
    OR v.accrued_quote IS NULL OR v.accrued_quote::text !~ '^[0-9]{1,13}([.][0-9]{1,8})?$' OR v.accrued_quote<0 THEN RETURN NULL; END IF;
  raw_holding := v.quoted_amount*CASE WHEN v.quote_units='per_100_nominal' THEN v.nominal_amount/100 ELSE 1 END;
  raw_accrued := v.accrued_quote*CASE WHEN v.quote_units='per_100_nominal' THEN v.nominal_amount/100 ELSE 1 END;
  raw_dirty := CASE WHEN v.quote_basis='clean' THEN raw_holding+raw_accrued ELSE raw_holding END;
  raw_clean := CASE WHEN v.quote_basis='clean' THEN raw_holding ELSE raw_holding-raw_accrued END;
  IF raw_clean<0 OR round(raw_dirty,2)>9999999999999.99 OR round(raw_clean,2)>9999999999999.99
    OR v.dirty_value IS DISTINCT FROM round(raw_dirty,2) OR v.clean_value IS DISTINCT FROM round(raw_clean,2)
    OR v.accrued_value IS DISTINCT FROM round(raw_dirty,2)-round(raw_clean,2) THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.grz_bond_payments WHERE public.grz_bond_payments.bond_id=b.id AND payment_type='coupon' ORDER BY id FOR SHARE;
  -- HTTP takes cash locks before accounts; repeat the fences for direct SQL.
  PERFORM 1 FROM public.transactions t WHERE t.household_id=b.household_id AND (
    t.id IN (SELECT income_transaction_id FROM public.grz_bond_payments WHERE public.grz_bond_payments.bond_id=b.id AND payment_type='coupon')
    OR t.id IN (SELECT history.entity_id FROM public.audit_logs history WHERE history.entity_type='transaction' AND history.action='CREATE'
      AND history.details ? 'grzCoupon' AND history.details->'grzCoupon'->>'bondId'=b.id::text AND history.details->'newValue'->>'type'='income')
    OR t.idempotency_key::text IN (SELECT x->>'postingKey' FROM jsonb_array_elements(v.coupon_state) x)) ORDER BY t.id FOR SHARE;
  PERFORM 1 FROM public.accounts a WHERE a.household_id=b.household_id AND (a.id=b.account_id OR a.id IN (
    SELECT t.account_id FROM public.transactions t WHERE t.household_id=b.household_id AND (
      t.id IN (SELECT cp.income_transaction_id FROM public.grz_bond_payments cp WHERE cp.bond_id=b.id AND cp.payment_type='coupon')
      OR t.id IN (SELECT history.entity_id FROM public.audit_logs history WHERE history.entity_type='transaction' AND history.action='CREATE'
        AND history.details ? 'grzCoupon' AND history.details->'grzCoupon'->>'bondId'=b.id::text AND history.details->'newValue'->>'type'='income'))))
    ORDER BY a.id FOR SHARE;
  PERFORM 1 FROM public.users WHERE id=actor_id AND erased_at IS NULL AND email_verified FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.id=b.account_id AND a.household_id=b.household_id
    AND a.currency='ZMW' AND a.is_asset AND a.deleted_at IS NULL AND (NOT a.is_private OR a.owner_user_id=actor_id)) THEN RETURN NULL; END IF;
  -- Do not prove absence from a JSON key or a withdrawn installment list.
  -- Every original coupon booking must still have its own certified paid row;
  -- the loop below independently checks its present cash and original terms.
  -- Ordinary transactions sharing a deterministic key have no such booking.
  IF EXISTS(SELECT 1 FROM public.audit_logs history WHERE history.entity_type='transaction' AND history.action='CREATE'
    AND history.details ? 'grzCoupon' AND history.details->'grzCoupon'->>'bondId'=b.id::text AND history.details->'newValue'->>'type'='income'
    AND NOT EXISTS(SELECT 1 FROM public.grz_bond_payments cp WHERE cp.bond_id=b.id AND cp.payment_type='coupon'
      AND cp.id::text=history.details->'grzCoupon'->>'paymentId' AND cp.status::text='paid' AND cp.income_transaction_id=history.entity_id)) THEN RETURN NULL; END IF;
  SELECT count(*) INTO row_count FROM public.grz_bond_payments WHERE public.grz_bond_payments.bond_id=b.id AND payment_type='coupon';
  IF row_count<>jsonb_array_length(v.coupon_state) THEN RETURN NULL; END IF;
  IF b.coupon_rate>0 THEN
    IF b.coupon_frequency IS NULL OR b.coupon_frequency NOT IN (1,2,3,4,6,12) THEN RETURN NULL; END IF;
    step := 12/b.coupon_frequency; boundary := coalesce(b.first_coupon_date,b.purchase_date);
    IF boundary<b.purchase_date OR boundary>b.maturity_date THEN RETURN NULL; END IF;
    months := (extract(year FROM b.maturity_date)::integer-extract(year FROM boundary)::integer)*12
      + extract(month FROM b.maturity_date)::integer-extract(month FROM boundary)::integer;
    IF months<0 OR months%step<>0 THEN RETURN NULL; END IF;
    periods := months/step; IF periods>1200 THEN RETURN NULL; END IF;
    use_maturity := public.grz_coupon_shift_months(b.maturity_date,-months)=boundary;
    IF NOT use_maturity AND public.grz_coupon_shift_months(boundary,months)<>b.maturity_date THEN RETURN NULL; END IF;
    start_index := CASE WHEN b.first_coupon_date IS NULL THEN 1 ELSE 0 END;
    IF periods<start_index THEN RETURN NULL; END IF;
    FOR i IN start_index..periods LOOP
      expected := CASE WHEN use_maturity THEN public.grz_coupon_shift_months(b.maturity_date,(i-periods)*step)
        ELSE public.grz_coupon_shift_months(boundary,i*step) END;
      dates := array_append(dates,expected);
    END LOOP;
    IF row_count<>cardinality(dates) THEN RETURN NULL; END IF;
    -- This is agreement with the application's versioned synthetic schedule
    -- rule, not a claim about a custodian's applicable tax policy. The generator
    -- taxes the unrounded period value, then persists gross and tax separately.
    period_value := b.face_value*b.coupon_rate/b.coupon_frequency;
    expected_gross := round(period_value,2); expected_tax := round(period_value*0.15,2);
    expected_net := expected_gross-expected_tax;
    IF expected_gross<0 OR expected_gross::text !~ '^[0-9]+([.][0-9]+)?$' THEN RETURN NULL; END IF;
  ELSE expected_gross := 0; expected_tax := 0; expected_net := 0; END IF;
  FOR p IN SELECT * FROM public.grz_bond_payments WHERE public.grz_bond_payments.bond_id=b.id AND payment_type='coupon' ORDER BY id LOOP
    IF p.gross_amount::text !~ '^[0-9]+([.][0-9]+)?$' OR p.withholding_tax IS NULL
      OR p.withholding_tax::text !~ '^[0-9]+([.][0-9]+)?$' OR p.net_amount::text !~ '^[0-9]+([.][0-9]+)?$'
      OR p.gross_amount<>expected_gross OR p.withholding_tax<>expected_tax OR p.net_amount<>expected_net
      OR p.gross_amount<>p.withholding_tax+p.net_amount OR p.investment_transaction_id IS NOT NULL
      OR p.payment_date<b.purchase_date OR p.payment_date>b.maturity_date THEN RETURN NULL; END IF;
    IF b.coupon_rate>0 THEN
      IF NOT p.payment_date=ANY(dates) THEN RETURN NULL; END IF;
      dates := array_remove(dates,p.payment_date);
    END IF;
    SELECT x INTO captured FROM jsonb_array_elements(v.coupon_state) x WHERE x->>'id'=p.id::text;
    IF NOT FOUND OR captured->>'paymentDate' IS DISTINCT FROM p.payment_date::text
      OR captured->>'gross' IS DISTINCT FROM p.gross_amount::text OR captured->>'withheld' IS DISTINCT FROM p.withholding_tax::text
      OR captured->>'net' IS DISTINCT FROM p.net_amount::text OR captured->>'investmentId' IS NOT NULL
      OR coalesce(captured->>'status','') NOT IN ('scheduled','paid') THEN RETURN NULL; END IF;
    IF p.gross_amount=0 THEN
      IF p.income_transaction_id IS NOT NULL OR p.actual_payment_date IS NOT NULL OR captured->>'incomeId' IS NOT NULL
        OR captured->>'actualDate' IS NOT NULL OR p.status::text IS DISTINCT FROM captured->>'status' THEN RETURN NULL; END IF;
      IF EXISTS(SELECT 1 FROM public.transactions t WHERE t.household_id=b.household_id AND t.idempotency_key::text=captured->>'postingKey'
        AND NOT EXISTS(SELECT 1 FROM public.transaction_create_owner_intents origin WHERE origin.transaction_id=t.id
          AND origin.household_id=t.household_id AND origin.idempotency_key=t.idempotency_key
          AND origin.posting_confirmed AND origin.operation<>'grz_coupon')) THEN RETURN NULL; END IF;
    ELSE
      IF p.status::text IS DISTINCT FROM 'paid' OR p.income_transaction_id IS NULL OR p.actual_payment_date IS NULL OR p.net_amount<=0 THEN RETURN NULL; END IF;
      IF captured->>'status'='paid' AND (captured->>'incomeId' IS DISTINCT FROM p.income_transaction_id::text
        OR captured->>'actualDate' IS DISTINCT FROM p.actual_payment_date::text) THEN RETURN NULL; END IF;
      IF captured->>'status'='scheduled' AND (captured->>'incomeId' IS NOT NULL OR captured->>'actualDate' IS NOT NULL) THEN RETURN NULL; END IF;
      SELECT * INTO cash FROM public.transactions t WHERE t.id=p.income_transaction_id;
      IF NOT FOUND OR cash.household_id<>b.household_id OR cash.type::text<>'income' OR cash.currency IS DISTINCT FROM 'ZMW'
        OR cash.amount<>p.net_amount OR cash.date<>p.actual_payment_date OR cash.date<p.payment_date OR cash.date>cut_date
        OR cash.deleted_at IS NOT NULL OR cash.is_pending OR cash.status::text='pending' OR cash.posting_mode IS DISTINCT FROM 'posted'
        OR cash.posted_account_is_asset IS DISTINCT FROM true OR cash.posted_balance_delta IS DISTINCT FROM cash.amount
        OR cash.idempotency_key::text IS DISTINCT FROM captured->>'postingKey'
        OR (cash.is_private AND cash.owner_user_id IS DISTINCT FROM actor_id) THEN RETURN NULL; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.id=cash.account_id AND a.household_id=b.household_id
        AND a.currency='ZMW' AND a.is_asset AND a.deleted_at IS NULL AND (NOT a.is_private OR a.owner_user_id=actor_id)) THEN RETURN NULL; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.transaction_create_owner_intents o WHERE o.transaction_id=cash.id AND o.household_id=b.household_id
        AND o.operation='grz_coupon' AND o.posting_confirmed AND o.idempotency_key=cash.idempotency_key) THEN RETURN NULL; END IF;
      SELECT count(*),count(*) FILTER (WHERE (a.details->'newValue') @> jsonb_build_object('accountId',cash.account_id::text,
          'amount',cash.amount::text,'currency','ZMW','date',cash.date::text,'type','income')
        AND a.details->'grzCoupon'=jsonb_build_object('version',1,'paymentId',p.id::text,'bondId',b.id::text,
          'dueDate',p.payment_date::text,'paymentType','coupon','grossAmount',p.gross_amount::text,
          'withholdingTax',p.withholding_tax::text,'netAmount',p.net_amount::text,'currency','ZMW')) INTO original_count,original_matches
        FROM public.audit_logs a WHERE a.entity_type='transaction' AND a.entity_id=cash.id AND a.action='CREATE';
      IF original_count<>1 OR original_matches<>1 THEN RETURN NULL; END IF;
      IF captured->>'status'='scheduled' AND p.payment_date=b.maturity_date THEN
        included_count := included_count+1;
        included_unpaid := included_unpaid+p.gross_amount;
      END IF;
    END IF;
    proof := proof||jsonb_build_array(jsonb_build_object('paymentId',p.id::text,'dueDate',p.payment_date::text,
      'schedulePolicyVersion','grz_app_schedule_15pct_v1',
      'grossAmount',p.gross_amount::text,'withholdingTax',p.withholding_tax::text,'netAmount',p.net_amount::text,
      'actualPaymentDate',p.actual_payment_date::text,'receiptTransactionId',p.income_transaction_id::text));
  END LOOP;
  IF cardinality(dates)<>0 OR v.accrued_value IS NULL OR v.accrued_value<0
    OR v.accrued_value::text !~ '^[0-9]+([.][0-9]+)?$'
    OR (v.accrued_value>0 AND (included_count<>1 OR included_unpaid<>v.accrued_value)) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('policyVersion','grz_principal_coupon_reconciled_v1','payments',proof);
END
$body$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.check_grz_principal_settlement_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
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
    AND event.receipt_date>=b.maturity_date AND event.receipt_date<=public.grz_household_business_date(event.household_id)
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
