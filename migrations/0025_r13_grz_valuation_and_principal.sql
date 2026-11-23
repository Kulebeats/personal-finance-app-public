ALTER TYPE "public"."transaction_type" ADD VALUE 'asset_settlement';--> statement-breakpoint
CREATE TABLE "grz_bond_valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigserial NOT NULL,
	"household_id" uuid NOT NULL,
	"bond_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"intent_hash" varchar(64) NOT NULL,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authority" varchar(30) NOT NULL,
	"isin" varchar(20) NOT NULL,
	"nominal_amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"valuation_date" date NOT NULL,
	"source_date" date NOT NULL,
	"source_kind" varchar(30) NOT NULL,
	"source_reference" text NOT NULL,
	"quote_basis" varchar(10) NOT NULL,
	"quote_units" varchar(30) NOT NULL,
	"quoted_amount" numeric(23, 8) NOT NULL,
	"accrued_quote" numeric(23, 8),
	"clean_value" numeric(15, 2),
	"dirty_value" numeric(15, 2) NOT NULL,
	"accrued_value" numeric(15, 2),
	"coupon_state" jsonb NOT NULL,
	"policy_version" varchar(60) NOT NULL,
	CONSTRAINT "ck_grz_valuation_authority" CHECK ("grz_bond_valuations"."authority"='member_recorded'),
	CONSTRAINT "ck_grz_valuation_currency" CHECK ("grz_bond_valuations"."currency"='ZMW'),
	CONSTRAINT "ck_grz_valuation_source_date" CHECK ("grz_bond_valuations"."source_date"="grz_bond_valuations"."valuation_date"),
	CONSTRAINT "ck_grz_valuation_source" CHECK ("grz_bond_valuations"."source_kind" in ('custodian_statement','same_issue_quote','same_issue_trade') and length(trim("grz_bond_valuations"."source_reference"))>0),
	CONSTRAINT "ck_grz_valuation_quote" CHECK ("grz_bond_valuations"."quote_basis" in ('clean','dirty') and "grz_bond_valuations"."quote_units" in ('holding_amount','per_100_nominal')
    and "grz_bond_valuations"."nominal_amount">0 and "grz_bond_valuations"."nominal_amount"::text ~ '^[0-9]+([.][0-9]+)?$'
    and "grz_bond_valuations"."quoted_amount">0 and "grz_bond_valuations"."quoted_amount"::text ~ '^[0-9]+([.][0-9]+)?$'
    and ("grz_bond_valuations"."accrued_quote" is null or ("grz_bond_valuations"."accrued_quote">=0 and "grz_bond_valuations"."accrued_quote"::text ~ '^[0-9]+([.][0-9]+)?$'))),
	CONSTRAINT "ck_grz_valuation_components" CHECK ("grz_bond_valuations"."dirty_value">=0 and "grz_bond_valuations"."dirty_value"::text ~ '^[0-9]+([.][0-9]+)?$' and
    (("grz_bond_valuations"."clean_value" is null and "grz_bond_valuations"."accrued_value" is null) or
    ("grz_bond_valuations"."clean_value" is not null and "grz_bond_valuations"."accrued_value" is not null and "grz_bond_valuations"."clean_value">=0 and "grz_bond_valuations"."accrued_value">=0
      and "grz_bond_valuations"."clean_value"::text ~ '^[0-9]+([.][0-9]+)?$' and "grz_bond_valuations"."accrued_value"::text ~ '^[0-9]+([.][0-9]+)?$'
      and "grz_bond_valuations"."clean_value"+"grz_bond_valuations"."accrued_value"="grz_bond_valuations"."dirty_value")))
);
--> statement-breakpoint
CREATE TABLE "grz_bond_principal_basis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigserial NOT NULL,
	"household_id" uuid NOT NULL,
	"bond_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"recorded_by" uuid,
	"operation_id" uuid NOT NULL,
	"intent_hash" varchar(64) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"authority" varchar(30) NOT NULL,
	"isin" varchar(20) NOT NULL,
	"nominal_amount" numeric(15, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"acquisition_date" date NOT NULL,
	"source_date" date NOT NULL,
	"source_kind" varchar(30) NOT NULL,
	"source_reference" text NOT NULL,
	"purchase_cash_amount" numeric(15, 2) NOT NULL,
	"principal_cost" numeric(15, 2) NOT NULL,
	"purchased_interest" numeric(15, 2) NOT NULL,
	"acquisition_fees" numeric(15, 2) NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	CONSTRAINT "chk_grz_principal_basis_terms" CHECK ("grz_bond_principal_basis"."authority"='member_recorded' and "grz_bond_principal_basis"."currency"='ZMW'
    and "grz_bond_principal_basis"."source_date">="grz_bond_principal_basis"."acquisition_date" and "grz_bond_principal_basis"."source_kind" in ('custodian_statement','trade_confirmation','contract_note')
    and "grz_bond_principal_basis"."source_reference" ~ '[^[:space:]]'
    and "grz_bond_principal_basis"."principal_cost">0 and "grz_bond_principal_basis"."purchased_interest">=0 and "grz_bond_principal_basis"."acquisition_fees">=0 and "grz_bond_principal_basis"."nominal_amount">0
    and "grz_bond_principal_basis"."purchase_cash_amount"="grz_bond_principal_basis"."principal_cost"+"grz_bond_principal_basis"."purchased_interest"+"grz_bond_principal_basis"."acquisition_fees"
    and "grz_bond_principal_basis"."principal_cost"::text ~ '^[0-9]+([.][0-9]+)?$' and "grz_bond_principal_basis"."purchased_interest"::text ~ '^[0-9]+([.][0-9]+)?$'
    and "grz_bond_principal_basis"."acquisition_fees"::text ~ '^[0-9]+([.][0-9]+)?$' and "grz_bond_principal_basis"."purchase_cash_amount"::text ~ '^[0-9]+([.][0-9]+)?$'
    and "grz_bond_principal_basis"."nominal_amount"::text ~ '^[0-9]+([.][0-9]+)?$')
);
--> statement-breakpoint
CREATE TABLE "grz_principal_settlements" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"bond_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"destination_account_id" uuid NOT NULL,
	"requested_receipt_id" uuid,
	"cash_transaction_id" uuid,
	"investment_transaction_id" uuid,
	"receipt_date" date NOT NULL,
	"request_digest" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"principal_amount" numeric(15, 2) NOT NULL,
	"received_amount" numeric(15, 2) NOT NULL,
	"cost_basis" numeric(15, 2),
	"realized_basis_difference" numeric(15, 2),
	"purchased_interest" numeric(15, 2),
	"acquisition_fees" numeric(15, 2),
	"basis_id" uuid,
	"basis_evidence" jsonb,
	"fees" numeric(15, 2) NOT NULL,
	"valuation_id" uuid,
	"valuation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "chk_grz_principal_state" CHECK ("grz_principal_settlements"."status" in ('pending','confirmed') and "grz_principal_settlements"."currency"='ZMW'
    and "grz_principal_settlements"."received_amount">0 and "grz_principal_settlements"."fees">=0
    and "grz_principal_settlements"."principal_amount"="grz_principal_settlements"."received_amount"+"grz_principal_settlements"."fees"
    and "grz_principal_settlements"."principal_amount"::text not in ('NaN','Infinity','-Infinity')
    and "grz_principal_settlements"."received_amount"::text not in ('NaN','Infinity','-Infinity')
    and "grz_principal_settlements"."fees"::text not in ('NaN','Infinity','-Infinity')
    and (("grz_principal_settlements"."basis_id" is null and "grz_principal_settlements"."cost_basis" is null and "grz_principal_settlements"."realized_basis_difference" is null
      and "grz_principal_settlements"."purchased_interest" is null and "grz_principal_settlements"."acquisition_fees" is null and "grz_principal_settlements"."basis_evidence" is null)
      or ("grz_principal_settlements"."basis_id" is not null and "grz_principal_settlements"."cost_basis" is not null and "grz_principal_settlements"."realized_basis_difference" is not null
        and "grz_principal_settlements"."purchased_interest" is not null and "grz_principal_settlements"."acquisition_fees" is not null
        and "grz_principal_settlements"."cost_basis">0 and "grz_principal_settlements"."purchased_interest">=0 and "grz_principal_settlements"."acquisition_fees">=0
        and "grz_principal_settlements"."cost_basis"::text not in ('NaN','Infinity','-Infinity') and "grz_principal_settlements"."purchased_interest"::text not in ('NaN','Infinity','-Infinity')
        and "grz_principal_settlements"."acquisition_fees"::text not in ('NaN','Infinity','-Infinity') and "grz_principal_settlements"."basis_evidence" is not null
        and "grz_principal_settlements"."realized_basis_difference"="grz_principal_settlements"."principal_amount"-"grz_principal_settlements"."cost_basis"))
    and (("grz_principal_settlements"."status"='pending' and "grz_principal_settlements"."cash_transaction_id" is null and "grz_principal_settlements"."investment_transaction_id" is null and "grz_principal_settlements"."confirmed_at" is null
      and "grz_principal_settlements"."valuation_id" is null and "grz_principal_settlements"."valuation" is null)
      or ("grz_principal_settlements"."status"='confirmed' and "grz_principal_settlements"."cash_transaction_id" is not null and "grz_principal_settlements"."investment_transaction_id" is not null
        and "grz_principal_settlements"."basis_id" is not null and "grz_principal_settlements"."valuation_id" is not null and "grz_principal_settlements"."valuation" is not null and "grz_principal_settlements"."confirmed_at" is not null)))
);
--> statement-breakpoint
ALTER TABLE "grz_bond_valuations" ADD CONSTRAINT "grz_bond_valuations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bond_valuations" ADD CONSTRAINT "grz_bond_valuations_bond_id_grz_bonds_id_fk" FOREIGN KEY ("bond_id") REFERENCES "public"."grz_bonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bond_valuations" ADD CONSTRAINT "grz_bond_valuations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bond_valuations" ADD CONSTRAINT "grz_bond_valuations_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bond_principal_basis" ADD CONSTRAINT "grz_bond_principal_basis_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bond_principal_basis" ADD CONSTRAINT "grz_bond_principal_basis_bond_id_grz_bonds_id_fk" FOREIGN KEY ("bond_id") REFERENCES "public"."grz_bonds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bond_principal_basis" ADD CONSTRAINT "grz_bond_principal_basis_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_bond_principal_basis" ADD CONSTRAINT "grz_bond_principal_basis_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_principal_settlements" ADD CONSTRAINT "grz_principal_settlements_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_principal_settlements" ADD CONSTRAINT "grz_principal_settlements_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_principal_settlements" ADD CONSTRAINT "grz_principal_settlements_bond_id_grz_bonds_id_fk" FOREIGN KEY ("bond_id") REFERENCES "public"."grz_bonds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_principal_settlements" ADD CONSTRAINT "grz_principal_settlements_payment_id_grz_bond_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."grz_bond_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_principal_settlements" ADD CONSTRAINT "grz_principal_settlements_destination_account_id_accounts_id_fk" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_principal_settlements" ADD CONSTRAINT "grz_principal_settlements_requested_receipt_id_transactions_id_fk" FOREIGN KEY ("requested_receipt_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_principal_settlements" ADD CONSTRAINT "grz_principal_settlements_cash_transaction_id_transactions_id_fk" FOREIGN KEY ("cash_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_principal_settlements" ADD CONSTRAINT "grz_principal_settlements_investment_transaction_id_investment_transactions_id_fk" FOREIGN KEY ("investment_transaction_id") REFERENCES "public"."investment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_principal_settlements" ADD CONSTRAINT "grz_principal_settlements_basis_id_grz_bond_principal_basis_id_fk" FOREIGN KEY ("basis_id") REFERENCES "public"."grz_bond_principal_basis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grz_principal_settlements" ADD CONSTRAINT "grz_principal_settlements_valuation_id_grz_bond_valuations_id_fk" FOREIGN KEY ("valuation_id") REFERENCES "public"."grz_bond_valuations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grz_valuation_household_operation" ON "grz_bond_valuations" USING btree ("household_id","operation_id");--> statement-breakpoint
CREATE INDEX "idx_grz_valuation_bond_date_sequence" ON "grz_bond_valuations" USING btree ("bond_id","valuation_date","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grz_basis_household_operation" ON "grz_bond_principal_basis" USING btree ("household_id","operation_id");--> statement-breakpoint
CREATE INDEX "idx_grz_basis_bond_sequence" ON "grz_bond_principal_basis" USING btree ("bond_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grz_principal_confirmed_payment" ON "grz_principal_settlements" USING btree ("payment_id") WHERE "grz_principal_settlements"."status"='confirmed';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grz_principal_confirmed_bond" ON "grz_principal_settlements" USING btree ("bond_id") WHERE "grz_principal_settlements"."status"='confirmed';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grz_principal_cash_receipt" ON "grz_principal_settlements" USING btree ("cash_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_grz_principal_investment" ON "grz_principal_settlements" USING btree ("investment_transaction_id");--> statement-breakpoint
CREATE FUNCTION public.guard_grz_principal_basis_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Principal basis evidence is append-only' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END
$body$;--> statement-breakpoint
CREATE TRIGGER grz_principal_basis_update_guard BEFORE UPDATE ON grz_bond_principal_basis
FOR EACH ROW EXECUTE FUNCTION public.guard_grz_principal_basis_update();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_grz_principal_basis_update() FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.guard_grz_principal_basis_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
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
  IF NEW.source_date>(transaction_timestamp() at time zone 'UTC')::date OR NEW.policy_version<>'grz_member_recorded_principal_basis_v1' THEN
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
CREATE TRIGGER grz_principal_basis_insert_guard BEFORE INSERT ON grz_bond_principal_basis
FOR EACH ROW EXECUTE FUNCTION public.guard_grz_principal_basis_insert();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_grz_principal_basis_insert() FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.guard_grz_principal_basis_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
  IF EXISTS (SELECT 1 FROM public.households WHERE id=OLD.household_id) THEN
    RAISE EXCEPTION 'Principal basis history requires whole-household erasure' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END
$body$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grz_principal_basis_delete_guard AFTER DELETE ON grz_bond_principal_basis
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_grz_principal_basis_delete();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_grz_principal_basis_delete() FROM PUBLIC;--> statement-breakpoint

CREATE FUNCTION public.guard_grz_principal_basis_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
BEGIN
  RAISE EXCEPTION 'Principal basis history cannot be truncated' USING ERRCODE='23514';
END
$body$;--> statement-breakpoint
CREATE TRIGGER grz_principal_basis_truncate_guard BEFORE TRUNCATE ON grz_bond_principal_basis
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_grz_principal_basis_truncate();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_grz_principal_basis_truncate() FROM PUBLIC;--> statement-breakpoint
CREATE FUNCTION public.grz_coupon_shift_months(anchor date, months integer) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $body$
  SELECT (date_trunc('month',anchor::timestamp+make_interval(months=>months))::date
    + (least(extract(day FROM anchor)::integer,
      extract(day FROM (date_trunc('month',anchor::timestamp+make_interval(months=>months))+interval '1 month - 1 day'))::integer)-1))::date
$body$;--> statement-breakpoint

CREATE INDEX idx_grz_coupon_booking_bond ON public.audit_logs((details->'grzCoupon'->>'bondId'))
  WHERE entity_type='transaction' AND action='CREATE' AND details ? 'grzCoupon';--> statement-breakpoint

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
$body$;--> statement-breakpoint

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
$body$;--> statement-breakpoint
CREATE TRIGGER grz_payment_principal_cash_guard BEFORE INSERT OR UPDATE ON public.grz_bond_payments
FOR EACH ROW EXECUTE FUNCTION public.guard_grz_payment_principal_cash();--> statement-breakpoint
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
$body$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grz_principal_event_binding AFTER INSERT OR UPDATE ON grz_principal_settlements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_grz_principal_settlement_binding();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grz_principal_cash_binding AFTER INSERT OR UPDATE ON transactions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_grz_principal_settlement_binding();--> statement-breakpoint

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
$body$;--> statement-breakpoint
CREATE TRIGGER grz_principal_cash_mutation_guard BEFORE UPDATE OR DELETE ON transactions
FOR EACH ROW WHEN (OLD.type::text='asset_settlement') EXECUTE FUNCTION public.guard_grz_principal_cash_mutation();--> statement-breakpoint

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
$body$;--> statement-breakpoint
CREATE TRIGGER grz_principal_event_update_guard BEFORE UPDATE ON grz_principal_settlements
FOR EACH ROW EXECUTE FUNCTION public.guard_grz_principal_event_update();--> statement-breakpoint

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
$body$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grz_principal_event_delete_guard AFTER DELETE ON grz_principal_settlements
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_grz_principal_event_delete();--> statement-breakpoint
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
