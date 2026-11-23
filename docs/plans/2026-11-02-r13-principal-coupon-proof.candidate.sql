-- ISOLATED common-0025 composition fragment; main owns migrations/journal.
-- Install these functions before the principal settlement binding function.
CREATE FUNCTION public.grz_coupon_shift_months(anchor date, months integer) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $body$
  SELECT (date_trunc('month',anchor::timestamp+make_interval(months=>months))::date
    + (least(extract(day FROM anchor)::integer,
      extract(day FROM (date_trunc('month',anchor::timestamp+make_interval(months=>months))+interval '1 month - 1 day'))::integer)-1))::date
$body$;

CREATE INDEX idx_grz_coupon_booking_bond ON public.audit_logs((details->'grzCoupon'->>'bondId'))
  WHERE entity_type='transaction' AND action='CREATE' AND details ? 'grzCoupon';

-- A dated observation is not evidence of cash. Scheduled -> paid requires
-- the same captured installment and its independent original booking proof.
CREATE FUNCTION public.grz_principal_coupon_proof(bond_id uuid, valuation_id uuid, receipt_date date, actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
DECLARE
  b public.grz_bonds; v public.grz_bond_valuations; p public.grz_bond_payments; cash public.transactions;
  captured jsonb; proof jsonb := '[]'::jsonb; dates date[] := ARRAY[]::date[];
  boundary date; expected date; months integer; step integer; periods integer; start_index integer;
  use_maturity boolean; row_count integer; i integer; original_count integer; original_matches integer;
  period_value numeric; expected_gross numeric; expected_tax numeric; expected_net numeric;
  raw_holding numeric; raw_accrued numeric; raw_dirty numeric; raw_clean numeric;
  included_unpaid numeric := 0; included_count integer := 0;
  captured_household uuid;
  cut_date date := (transaction_timestamp() at time zone 'UTC')::date;
BEGIN
  SELECT * INTO b FROM public.grz_bonds WHERE id=bond_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  captured_household := b.household_id;
  PERFORM 1 FROM public.households WHERE id=captured_household FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.household_members m WHERE m.household_id=captured_household AND m.user_id=actor_id
    AND m.role::text IN ('owner','admin','member') FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
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
$body$;

-- A principal-side exclusion alone cannot stop a later or blocked payment
-- writer from claiming the cash after the settlement commits. SHARE conflicts
-- with an ordinary non-key reclassification and rechecks the current version.
CREATE FUNCTION public.guard_grz_payment_principal_cash() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
DECLARE cash_kind text;
BEGIN
  IF NEW.income_transaction_id IS NULL THEN RETURN NEW; END IF;
  SELECT t.type::text INTO cash_kind FROM public.transactions t WHERE t.id=NEW.income_transaction_id FOR SHARE;
  IF NOT FOUND THEN RETURN NEW; END IF; -- the existing FK reports a missing row
  -- Confirmed principal binding requires asset_settlement and its mutation
  -- guard forbids reverting to income. No principal-history read is needed.
  IF cash_kind<>'income' THEN
    RAISE EXCEPTION 'Payment cash is not an available income receipt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$body$;
CREATE TRIGGER grz_payment_principal_cash_guard BEFORE INSERT OR UPDATE ON public.grz_bond_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_grz_payment_principal_cash();
