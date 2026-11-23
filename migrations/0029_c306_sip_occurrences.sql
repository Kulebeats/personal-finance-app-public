-- C3-06 scheduled purchases: a due occurrence waits as pending until an authorized
-- user confirms it from the final broker statement; each fill is its own purchase and lot.
-- No backfill, price schema, or historical grant/proof reinterpretation.
ALTER TABLE public.households ADD COLUMN time_zone varchar(100);
--> statement-breakpoint
-- Lookup only: historical lots are not assumed unique by transaction.
CREATE INDEX idx_tax_lots_transaction ON public.tax_lots(transaction_id);
--> statement-breakpoint
CREATE TABLE public.investment_sip_occurrence_fences (
  plan_id uuid NOT NULL,
  original_due_date date NOT NULL,
  terminal boolean NOT NULL DEFAULT false,
  CONSTRAINT investment_sip_occurrence_fence_pk PRIMARY KEY(plan_id,original_due_date),
  CONSTRAINT investment_sip_occurrence_fence_plan_fk FOREIGN KEY(plan_id) REFERENCES public.recurring_investments(id) ON DELETE CASCADE,
  CONSTRAINT investment_sip_fence_date CHECK(original_due_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
);
--> statement-breakpoint
CREATE TABLE public.investment_sip_occurrences (
  plan_id uuid NOT NULL,
  original_due_date date NOT NULL,
  household_id uuid NOT NULL,
  account_id uuid NOT NULL,
  security_id uuid NOT NULL,
  planned_amount numeric(15,2) NOT NULL,
  currency varchar(3) NOT NULL,
  authorized_frequency public.recurring_frequency NOT NULL,
  authorized_initial_date date NOT NULL,
  occurrence_revision integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'pending',
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT investment_sip_occurrence_pk PRIMARY KEY(plan_id,original_due_date),
  CONSTRAINT investment_sip_occurrence_scope UNIQUE(plan_id,original_due_date,household_id),
  CONSTRAINT investment_sip_occurrence_fence_fk FOREIGN KEY(plan_id,original_due_date)
    REFERENCES public.investment_sip_occurrence_fences(plan_id,original_due_date) ON DELETE CASCADE,
  CONSTRAINT investment_sip_occurrence_plan_scope_fk FOREIGN KEY(plan_id,household_id)
    REFERENCES public.recurring_investments(id,household_id) ON DELETE CASCADE,
  CONSTRAINT investment_sip_occurrence_state CHECK((state='pending' AND occurrence_revision=0) OR (state='closed' AND occurrence_revision=1)),
  CONSTRAINT investment_sip_occurrence_amount CHECK(planned_amount>0 AND planned_amount::text ~ '^[0-9]+[.][0-9]{2}$'),
  CONSTRAINT investment_sip_occurrence_currency CHECK(currency ~ '^[A-Z]{3}$'),
  CONSTRAINT investment_sip_occurrence_frequency CHECK(authorized_frequency<>'custom'),
  CONSTRAINT investment_sip_occurrence_initial_date CHECK(authorized_initial_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31')
);
--> statement-breakpoint
CREATE INDEX investment_sip_occurrence_household_date ON public.investment_sip_occurrences(household_id,plan_id,original_due_date);
--> statement-breakpoint
CREATE TABLE public.investment_sip_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  original_due_date date NOT NULL,
  expected_occurrence_revision integer NOT NULL,
  request_version smallint NOT NULL,
  request_digest varchar(64) NOT NULL,
  outcome text NOT NULL,
  fill_count integer NOT NULL,
  broker_reference text,
  authorized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmation_cutoff_date date NOT NULL,
  security_generation integer NOT NULL,
  CONSTRAINT investment_sip_confirmation_actor_fk FOREIGN KEY(actor_user_id) REFERENCES public.users(id),
  CONSTRAINT investment_sip_confirmation_household_fk FOREIGN KEY(household_id) REFERENCES public.households(id) ON DELETE CASCADE,
  CONSTRAINT investment_sip_confirmation_revision CHECK(expected_occurrence_revision=0),
  CONSTRAINT investment_sip_confirmation_version CHECK(request_version=1),
  CONSTRAINT investment_sip_confirmation_digest CHECK(request_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT investment_sip_confirmation_generation CHECK(security_generation>=0),
  CONSTRAINT investment_sip_confirmation_operation UNIQUE(household_id,actor_user_id,operation_id),
  CONSTRAINT investment_sip_confirmation_occurrence UNIQUE(plan_id,original_due_date),
  CONSTRAINT investment_sip_confirmation_occurrence_fk FOREIGN KEY(plan_id,original_due_date,household_id)
    REFERENCES public.investment_sip_occurrences(plan_id,original_due_date,household_id) ON DELETE CASCADE,
  CONSTRAINT investment_sip_confirmation_cardinality CHECK((outcome='unfilled' AND fill_count=0) OR
    (outcome IN ('filled','partially_filled') AND fill_count BETWEEN 1 AND 100)),
  CONSTRAINT investment_sip_confirmation_reference CHECK(broker_reference IS NULL OR
    (char_length(broker_reference) BETWEEN 1 AND 200 AND broker_reference ~ '[^[:space:]]'))
);
--> statement-breakpoint
CREATE INDEX investment_sip_confirmation_actor_household ON public.investment_sip_confirmations(actor_user_id,household_id);
--> statement-breakpoint
CREATE TABLE public.investment_sip_confirmed_fills (
  confirmation_id uuid NOT NULL,
  fill_index integer NOT NULL,
  purchase_id uuid NOT NULL,
  execution_date date NOT NULL,
  quantity numeric(18,8) NOT NULL,
  price numeric(15,4) NOT NULL,
  fees numeric(15,2) NOT NULL,
  amount numeric(15,2) NOT NULL,
  creation_xid text NOT NULL,
  posting_confirmed boolean NOT NULL DEFAULT false,
  CONSTRAINT investment_sip_confirmed_fill_pk PRIMARY KEY(confirmation_id,fill_index),
  CONSTRAINT investment_sip_confirmed_fill_purchase UNIQUE(purchase_id),
  CONSTRAINT investment_sip_confirmed_fill_confirmation_fk FOREIGN KEY(confirmation_id) REFERENCES public.investment_sip_confirmations(id) ON DELETE CASCADE,
  CONSTRAINT investment_sip_confirmed_fill_index CHECK(fill_index BETWEEN 0 AND 99),
  CONSTRAINT investment_sip_confirmed_fill_date CHECK(execution_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  CONSTRAINT investment_sip_confirmed_fill_quantity CHECK(quantity>0 AND quantity::text ~ '^[0-9]+[.][0-9]{8}$'),
  CONSTRAINT investment_sip_confirmed_fill_price CHECK(price>0 AND price::text ~ '^[0-9]+[.][0-9]{4}$'),
  CONSTRAINT investment_sip_confirmed_fill_fees CHECK(fees>=0 AND fees::text ~ '^[0-9]+[.][0-9]{2}$'),
  CONSTRAINT investment_sip_confirmed_fill_amount CHECK(amount>=0 AND amount=round(quantity*price,2)+fees AND amount::text ~ '^[0-9]+[.][0-9]{2}$'),
  CONSTRAINT investment_sip_confirmed_fill_purchase_fk FOREIGN KEY(purchase_id)
    REFERENCES public.investment_transactions(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
-- The completed-proof shape remains exactly seven columns. Standing grants stay v1.
ALTER TABLE public.investment_purchase_authorization_proofs
  DROP CONSTRAINT investment_purchase_authoriz_authorization_contract_versi_check;
--> statement-breakpoint
ALTER TABLE public.investment_purchase_authorization_proofs
  ADD CONSTRAINT investment_purchase_authoriz_authorization_contract_versi_check
  CHECK(authorization_contract_version IN (1,2));
--> statement-breakpoint
CREATE FUNCTION public.c306_sip_fill_digest(purchase_uuid uuid, cadence public.recurring_frequency, initial_date date)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog, pg_temp AS $body$
  SELECT encode(sha256(convert_to(format(
    '[2,"record_only_sip_actual_fill",%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,null,null]',
    to_json(p.account_id::text),to_json(p.security_id::text),to_json(p.quantity::text),to_json(p.price::text),
    to_json(p.fees::text),to_json(p.amount::text),to_json(p.currency::text),to_json(to_char(p.transaction_date,'YYYY-MM-DD')),
    to_json(cadence::text),to_json(to_char(initial_date,'YYYY-MM-DD'))),'UTF8')),'hex')
  FROM public.investment_transactions p WHERE p.id=purchase_uuid AND p.fx_rate IS NULL AND p.amount_zmw IS NULL
$body$;
--> statement-breakpoint
-- Original financial fields/audit/lot, without requiring live actor authority.
-- This helper is not an authorization grant and contains no broker reference.
CREATE FUNCTION public.c306_sip_fill_evidence(purchase_uuid uuid) RETURNS boolean
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
      AND p.amount=f.amount AND p.transaction_date=f.execution_date AND p.fx_rate IS NULL AND p.amount_zmw IS NULL
      AND p.linked_transaction_id IS NULL AND p.notes IS NULL AND coalesce(p.withholding_tax,0)=0
      AND (SELECT count(*) FROM public.tax_lots l WHERE l.transaction_id=p.id)=1
      AND EXISTS(SELECT 1 FROM public.tax_lots l WHERE l.transaction_id=p.id AND l.holding_id=p.holding_id
        AND l.household_id=p.household_id AND l.quantity=p.quantity AND l.cost_basis=p.amount
        AND l.remaining_quantity=l.quantity AND l.acquired_date=p.transaction_date
        AND l.cost_basis_zmw IS NULL AND l.acquisition_fx_rate IS NULL)
      AND (SELECT count(*) FROM public.audit_logs a WHERE a.entity_id=p.id
        AND a.entity_type='investment_transaction' AND a.action='CREATE')=1
      AND EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.entity_id=p.id AND a.entity_type='investment_transaction'
        AND a.action='CREATE' AND a.user_id=c.actor_user_id AND a.ip_address IS NULL
        AND ((custody.is_private AND a.household_id IS NULL) OR (NOT custody.is_private AND a.household_id=o.household_id))
        AND a.details=jsonb_build_object('newValue',jsonb_build_object('type','buy','accountId',p.account_id::text,
          'holdingId',p.holding_id::text,'securityId',p.security_id::text,'quantity',p.quantity::text,'amount',p.amount::text,
          'currency',p.currency,'transactionDate',to_char(p.transaction_date,'YYYY-MM-DD'),'price',p.price::text,
          'fees',p.fees::text,'feesDeclared',true))))
$body$;
--> statement-breakpoint
CREATE FUNCTION public.c306_sip_confirmation_complete(confirmation_uuid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path=pg_catalog, pg_temp AS $body$
  SELECT EXISTS(SELECT 1 FROM public.investment_sip_confirmations c
    JOIN public.investment_sip_occurrences o ON o.plan_id=c.plan_id AND o.original_due_date=c.original_due_date
    WHERE c.id=confirmation_uuid
      AND (SELECT count(*) FROM public.investment_sip_confirmed_fills f WHERE f.confirmation_id=c.id)=c.fill_count
      AND NOT EXISTS(SELECT 1 FROM public.investment_sip_confirmed_fills f WHERE f.confirmation_id=c.id
        AND (f.fill_index>=c.fill_count OR NOT public.c306_sip_fill_evidence(f.purchase_id)
          OR NOT EXISTS(SELECT 1 FROM public.investment_purchase_authorization_proofs proof
            WHERE proof.purchase_id=f.purchase_id AND proof.authorization_contract_version=2
              AND proof.author_user_id=c.actor_user_id AND proof.authorized_at=c.authorized_at
              AND proof.authorized_frequency=o.authorized_frequency AND proof.authorized_initial_date=o.authorized_initial_date
              AND proof.authorized_terms_digest=public.c306_sip_fill_digest(f.purchase_id,o.authorized_frequency,o.authorized_initial_date))))
      AND coalesce((SELECT sum(f.quantity) FROM public.investment_sip_confirmed_fills f WHERE f.confirmation_id=c.id),0)<10000000000
      AND coalesce((SELECT sum(f.amount) FROM public.investment_sip_confirmed_fills f WHERE f.confirmation_id=c.id),0)<=9999999999999.99
      AND (SELECT count(*) FROM public.audit_logs a WHERE a.entity_type='investment_sip_confirmation'
        AND a.entity_id=c.id AND a.action='CREATE')=1
      AND EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.entity_type='investment_sip_confirmation' AND a.entity_id=c.id
        AND a.action='CREATE' AND a.user_id=c.actor_user_id AND a.household_id IS NULL AND a.ip_address IS NULL
        AND a.details='{"authorizationEvent":"sip_final_confirmation_v1","requestVersion":1}'::jsonb))
$body$;
--> statement-breakpoint
CREATE FUNCTION public.c306_guard_plan_custody() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF (NEW.id,NEW.household_id,NEW.account_id) IS DISTINCT FROM (OLD.id,OLD.household_id,OLD.account_id)
    AND EXISTS(SELECT 1 FROM public.investment_sip_occurrence_fences WHERE plan_id=OLD.id) THEN
    RAISE EXCEPTION 'An existing investment occurrence cannot change custody' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER c306_guard_plan_custody BEFORE UPDATE ON public.recurring_investments
  FOR EACH ROW EXECUTE FUNCTION public.c306_guard_plan_custody();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.c306_guard_plan_custody() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.c306_guard_occurrence_fence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM public.investment_sip_confirmations c
      WHERE c.plan_id=OLD.plan_id AND c.original_due_date=OLD.original_due_date
        AND public.investment_sip_owns_xid(c.xmin)) THEN
      RAISE EXCEPTION 'Current confirmation witnesses must survive their creation transaction' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.recurring_investments WHERE id=OLD.plan_id) THEN RETURN OLD; END IF;
  ELSIF TG_OP='INSERT' THEN
    -- FK key-share does not serialize non-key custody changes. Own the parent
    -- before validating first identity and hold it through snapshot/advance.
    PERFORM id FROM public.recurring_investments WHERE id=NEW.plan_id FOR UPDATE;
    NEW.terminal:=false;
    IF EXISTS(SELECT 1 FROM public.recurring_investments p
      JOIN public.investment_plan_authorizations g ON g.id=p.current_authorization_id AND g.plan_id=p.id
      JOIN public.users u ON u.id=g.author_user_id
      JOIN public.household_members m ON m.household_id=p.household_id AND m.user_id=g.author_user_id
      WHERE p.id=NEW.plan_id AND p.next_execution_date=NEW.original_due_date AND p.is_active AND p.type='sip'
        AND g.revision=p.authorization_revision AND g.household_id=p.household_id
        AND g.authorization_contract_version=1 AND g.authorization_kind='record_only_sip'
        AND u.erased_at IS NULL AND u.email_verified AND u.security_generation=g.security_generation
        AND m.role IN ('owner','admin','member') AND p.account_id=g.account_id AND p.security_id=g.security_id
        AND p.amount=g.amount AND p.currency=g.currency AND p.frequency=g.frequency AND p.frequency<>'custom') THEN
      RETURN NEW;
    END IF;
  ELSIF NOT OLD.terminal AND NEW.terminal AND NEW.plan_id=OLD.plan_id AND NEW.original_due_date=OLD.original_due_date
    AND EXISTS(SELECT 1 FROM public.investment_sip_confirmations c WHERE c.plan_id=OLD.plan_id
      AND c.original_due_date=OLD.original_due_date AND public.investment_sip_owns_xid(c.xmin)
      AND public.c306_sip_confirmation_complete(c.id)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Investment occurrence identity is immutable or incomplete' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER c306_guard_occurrence_fence BEFORE INSERT OR UPDATE OR DELETE ON public.investment_sip_occurrence_fences
  FOR EACH ROW EXECUTE FUNCTION public.c306_guard_occurrence_fence();
--> statement-breakpoint
CREATE FUNCTION public.c306_guard_occurrence_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state='pending' AND NEW.occurrence_revision=0 AND EXISTS(SELECT 1
      FROM public.investment_sip_occurrence_fences f JOIN public.recurring_investments p ON p.id=f.plan_id
      JOIN public.investment_plan_authorizations g ON g.id=p.current_authorization_id AND g.plan_id=p.id
      WHERE f.plan_id=NEW.plan_id AND f.original_due_date=NEW.original_due_date AND NOT f.terminal
        AND public.investment_sip_owns_xid(f.xmin) AND p.next_execution_date=NEW.original_due_date
        AND p.household_id=NEW.household_id AND p.account_id=NEW.account_id AND p.security_id=NEW.security_id
        AND p.amount=NEW.planned_amount AND p.currency=NEW.currency AND p.frequency=NEW.authorized_frequency
        AND g.initial_execution_date=NEW.authorized_initial_date) THEN RETURN NEW; END IF;
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.state='pending' AND NEW.state='closed' AND OLD.occurrence_revision=0 AND NEW.occurrence_revision=1
      AND (to_jsonb(OLD)-'state'-'occurrence_revision')=(to_jsonb(NEW)-'state'-'occurrence_revision')
      AND EXISTS(SELECT 1 FROM public.investment_sip_confirmations c WHERE c.plan_id=OLD.plan_id
        AND c.original_due_date=OLD.original_due_date AND public.investment_sip_owns_xid(c.xmin)
        AND public.c306_sip_confirmation_complete(c.id)) THEN RETURN NEW; END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM public.investment_sip_confirmations c
      WHERE c.plan_id=OLD.plan_id AND c.original_due_date=OLD.original_due_date
        AND public.investment_sip_owns_xid(c.xmin)) THEN
      RAISE EXCEPTION 'Current confirmation witnesses must survive their creation transaction' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.recurring_investments WHERE id=OLD.plan_id)
      OR NOT EXISTS(SELECT 1 FROM public.households WHERE id=OLD.household_id) THEN RETURN OLD; END IF;
    IF OLD.state='closed' AND EXISTS(SELECT 1 FROM public.investment_sip_confirmations c
      JOIN public.users u ON u.id=c.actor_user_id JOIN public.investment_sip_occurrence_fences f
        ON f.plan_id=c.plan_id AND f.original_due_date=c.original_due_date
      WHERE c.plan_id=OLD.plan_id AND c.original_due_date=OLD.original_due_date AND f.terminal AND u.erased_at IS NOT NULL
        AND NOT public.investment_sip_owns_xid(c.xmin)) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'Investment occurrence snapshot is immutable or incomplete' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER c306_guard_occurrence_snapshot BEFORE INSERT OR UPDATE OR DELETE ON public.investment_sip_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.c306_guard_occurrence_snapshot();
--> statement-breakpoint
CREATE FUNCTION public.c306_guard_confirmation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
DECLARE selected_zone text;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT h.time_zone INTO selected_zone FROM public.investment_sip_occurrences o
      JOIN public.investment_sip_occurrence_fences f ON f.plan_id=o.plan_id AND f.original_due_date=o.original_due_date
      JOIN public.households h ON h.id=o.household_id
      JOIN public.accounts a ON a.id=o.account_id AND a.household_id=o.household_id
      JOIN public.securities s ON s.id=o.security_id
      JOIN public.users u ON u.id=NEW.actor_user_id
      JOIN public.household_members m ON m.household_id=o.household_id AND m.user_id=u.id
      WHERE o.plan_id=NEW.plan_id AND o.original_due_date=NEW.original_due_date AND o.household_id=NEW.household_id
        AND o.state='pending' AND o.occurrence_revision=NEW.expected_occurrence_revision AND NOT f.terminal
        AND u.erased_at IS NULL AND u.email_verified AND u.security_generation=NEW.security_generation
        AND m.role IN ('owner','admin','member') AND a.deleted_at IS NULL AND (NOT a.is_private OR a.owner_user_id=u.id)
        AND s.type<>'tbill' AND s.currency=o.currency;
    IF selected_zone IS NOT NULL AND EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=selected_zone) THEN
      NEW.authorized_at:=clock_timestamp();
      NEW.confirmation_cutoff_date:=(NEW.authorized_at AT TIME ZONE selected_zone)::date;
      RETURN NEW;
    END IF;
  ELSIF TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM public.investment_sip_confirmations c
      WHERE c.id=OLD.id AND public.investment_sip_owns_xid(c.xmin)) THEN
      RAISE EXCEPTION 'Current confirmation witnesses must survive their creation transaction' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.investment_sip_occurrences
      WHERE plan_id=OLD.plan_id AND original_due_date=OLD.original_due_date) THEN RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'Investment confirmation is unavailable or immutable' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER c306_guard_confirmation BEFORE INSERT OR UPDATE OR DELETE ON public.investment_sip_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.c306_guard_confirmation();
--> statement-breakpoint
CREATE FUNCTION public.c306_guard_confirmed_fill() RETURNS trigger
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
          AND p.amount=OLD.amount AND p.transaction_date=OLD.execution_date AND p.fx_rate IS NULL AND p.amount_zmw IS NULL) THEN RETURN NEW; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM public.investment_transactions WHERE id=OLD.purchase_id)
      OR (NOT EXISTS(SELECT 1 FROM public.investment_sip_confirmations WHERE id=OLD.confirmation_id)
        AND EXISTS(SELECT 1 FROM public.investment_purchase_authorization_proofs WHERE purchase_id=OLD.purchase_id
          AND authorization_contract_version=2)) THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'Actual fill reservation is unavailable or immutable' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER c306_guard_confirmed_fill BEFORE INSERT OR UPDATE OR DELETE ON public.investment_sip_confirmed_fills
  FOR EACH ROW EXECUTE FUNCTION public.c306_guard_confirmed_fill();
--> statement-breakpoint
CREATE FUNCTION public.c306_seal_actual_purchase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  UPDATE public.investment_sip_confirmed_fills SET posting_confirmed=true
    WHERE purchase_id=NEW.id AND creation_xid=pg_current_xact_id()::text;
  RETURN NULL;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER c306_seal_actual_purchase AFTER INSERT ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.c306_seal_actual_purchase();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.c306_seal_actual_purchase() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.c306_guard_reserved_purchase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.investment_sip_confirmed_fills
    WHERE purchase_id=NEW.id AND creation_xid<>pg_current_xact_id()::text) THEN
    RAISE EXCEPTION 'Actual purchase must belong to its reservation transaction' USING ERRCODE='23514';
  ELSIF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.investment_sip_confirmed_fills
    WHERE purchase_id IN (OLD.id,NEW.id) AND (NOT posting_confirmed OR creation_xid=pg_current_xact_id()::text)) THEN
    RAISE EXCEPTION 'Actual fill can only bind a genuine new purchase INSERT' USING ERRCODE='23514';
  ELSIF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.investment_sip_confirmed_fills
    WHERE purchase_id=OLD.id AND creation_xid=pg_current_xact_id()::text) THEN
    RAISE EXCEPTION 'Cannot replace an actual purchase during creation' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER c306_guard_reserved_purchase BEFORE INSERT OR UPDATE OR DELETE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.c306_guard_reserved_purchase();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.c306_guard_reserved_purchase() FROM PUBLIC;
--> statement-breakpoint
-- Keep the old v1 function BODY unchanged; dispatch its three event kinds by version.
DROP TRIGGER guard_investment_purchase_authorization_proof ON public.investment_purchase_authorization_proofs;
--> statement-breakpoint
CREATE TRIGGER guard_investment_purchase_authorization_proof BEFORE INSERT ON public.investment_purchase_authorization_proofs
  FOR EACH ROW WHEN(NEW.authorization_contract_version=1) EXECUTE FUNCTION public.guard_investment_purchase_authorization_proof();
--> statement-breakpoint
CREATE TRIGGER c306_v1_proof_update BEFORE UPDATE ON public.investment_purchase_authorization_proofs
  FOR EACH ROW WHEN(OLD.authorization_contract_version=1 OR NEW.authorization_contract_version=1)
  EXECUTE FUNCTION public.guard_investment_purchase_authorization_proof();
--> statement-breakpoint
CREATE TRIGGER c306_v1_proof_delete BEFORE DELETE ON public.investment_purchase_authorization_proofs
  FOR EACH ROW WHEN(OLD.authorization_contract_version=1) EXECUTE FUNCTION public.guard_investment_purchase_authorization_proof();
--> statement-breakpoint
CREATE FUNCTION public.c306_guard_fill_proof() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.investment_transactions WHERE id=OLD.purchase_id) THEN RETURN OLD; END IF;
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.investment_sip_confirmed_fills f
    JOIN public.investment_sip_confirmations c ON c.id=f.confirmation_id
    JOIN public.investment_sip_occurrences o ON o.plan_id=c.plan_id AND o.original_due_date=c.original_due_date
    JOIN public.investment_transactions p ON p.id=f.purchase_id
    JOIN public.users u ON u.id=c.actor_user_id
    JOIN public.household_members m ON m.household_id=c.household_id AND m.user_id=u.id
    JOIN public.accounts a ON a.id=o.account_id AND a.household_id=o.household_id
    JOIN public.securities s ON s.id=o.security_id
    WHERE p.id=NEW.purchase_id AND f.creation_xid=pg_current_xact_id()::text AND public.investment_sip_owns_xid(p.xmin)
      AND public.investment_sip_owns_xid(c.xmin) AND public.c306_sip_fill_evidence(p.id)
      AND o.state='pending' AND u.erased_at IS NULL AND u.email_verified AND u.security_generation=c.security_generation
      AND a.deleted_at IS NULL AND (NOT a.is_private OR a.owner_user_id=u.id)
      AND s.currency=o.currency AND s.type<>'tbill'
      AND m.role IN ('owner','admin','member') AND NEW.author_user_id=c.actor_user_id AND NEW.authorized_at=c.authorized_at
      AND NEW.authorized_frequency=o.authorized_frequency AND NEW.authorized_initial_date=o.authorized_initial_date
      AND NEW.authorized_terms_digest=public.c306_sip_fill_digest(p.id,o.authorized_frequency,o.authorized_initial_date)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Completed actual-fill proof is unavailable or immutable' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER c306_v2_proof_insert BEFORE INSERT ON public.investment_purchase_authorization_proofs
  FOR EACH ROW WHEN(NEW.authorization_contract_version=2) EXECUTE FUNCTION public.c306_guard_fill_proof();
--> statement-breakpoint
CREATE TRIGGER c306_v2_proof_update BEFORE UPDATE ON public.investment_purchase_authorization_proofs
  FOR EACH ROW WHEN(OLD.authorization_contract_version=2 OR NEW.authorization_contract_version=2)
  EXECUTE FUNCTION public.c306_guard_fill_proof();
--> statement-breakpoint
CREATE TRIGGER c306_v2_proof_delete BEFORE DELETE ON public.investment_purchase_authorization_proofs
  FOR EACH ROW WHEN(OLD.authorization_contract_version=2) EXECUTE FUNCTION public.c306_guard_fill_proof();
--> statement-breakpoint
CREATE FUNCTION public.c306_require_fill_proof() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF (EXISTS(SELECT 1 FROM public.investment_sip_confirmed_fills WHERE purchase_id=NEW.purchase_id)
      OR EXISTS(SELECT 1 FROM public.investment_transactions WHERE id=NEW.purchase_id))
    AND NOT EXISTS(SELECT 1 FROM public.investment_purchase_authorization_proofs
      WHERE purchase_id=NEW.purchase_id AND authorization_contract_version=2) THEN
    RAISE EXCEPTION 'Actual fill requires its completed new purchase proof' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END
$body$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER c306_require_fill_proof AFTER INSERT ON public.investment_sip_confirmed_fills
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.c306_require_fill_proof();
--> statement-breakpoint
CREATE FUNCTION public.c306_require_closed_confirmation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  PERFORM public.c306_recheck_current_confirmation(NEW.id);
  RETURN NULL;
END
$body$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER c306_require_closed_confirmation AFTER INSERT ON public.investment_sip_confirmations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.c306_require_closed_confirmation();
--> statement-breakpoint
CREATE FUNCTION public.c306_require_materialized_occurrence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  PERFORM public.c306_recheck_current_plan(NEW.plan_id);
  RETURN NULL;
END
$body$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER c306_require_materialized_occurrence AFTER INSERT ON public.investment_sip_occurrence_fences
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.c306_require_materialized_occurrence();
--> statement-breakpoint
-- These checks are deliberately transaction-origin scoped. They protect a
-- just-created batch through selective early flushes without reapplying its
-- initial lot/current-actor predicates during later FIFO or actor erasure.
CREATE FUNCTION public.c306_recheck_current_confirmation(confirmation_uuid uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
DECLARE receipt record;
BEGIN
  SELECT c.*,c.xmin AS origin_xid INTO receipt FROM public.investment_sip_confirmations c WHERE c.id=confirmation_uuid;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT public.investment_sip_owns_xid(receipt.origin_xid) THEN RETURN; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.investment_sip_occurrences o
    JOIN public.investment_sip_occurrence_fences f ON f.plan_id=o.plan_id AND f.original_due_date=o.original_due_date
    JOIN public.recurring_investments p ON p.id=o.plan_id
    JOIN public.accounts a ON a.id=o.account_id AND a.household_id=o.household_id
    WHERE o.plan_id=receipt.plan_id AND o.original_due_date=receipt.original_due_date
      AND o.state='closed' AND o.occurrence_revision=1 AND f.terminal AND p.next_execution_date>o.original_due_date
      AND a.deleted_at IS NULL AND (NOT a.is_private OR a.owner_user_id=receipt.actor_user_id)
      AND public.c306_sip_confirmation_complete(receipt.id)) THEN
    RAISE EXCEPTION 'Actual confirmation requires one complete atomic closure' USING ERRCODE='23514';
  END IF;
END
$body$;
--> statement-breakpoint
CREATE FUNCTION public.c306_recheck_current_plan(plan_uuid uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
DECLARE receipt_id uuid;
BEGIN
  IF EXISTS(SELECT 1 FROM public.investment_sip_occurrence_fences f
    WHERE f.plan_id=plan_uuid AND public.investment_sip_owns_xid(f.xmin)
      AND NOT EXISTS(SELECT 1 FROM public.investment_sip_occurrences o JOIN public.recurring_investments p ON p.id=o.plan_id
        WHERE o.plan_id=f.plan_id AND o.original_due_date=f.original_due_date AND p.next_execution_date>f.original_due_date)) THEN
    RAISE EXCEPTION 'Occurrence and cursor must remain materialized atomically' USING ERRCODE='23514';
  END IF;
  FOR receipt_id IN SELECT c.id FROM public.investment_sip_confirmations c
    WHERE c.plan_id=plan_uuid AND public.investment_sip_owns_xid(c.xmin) LOOP
    PERFORM public.c306_recheck_current_confirmation(receipt_id);
  END LOOP;
END
$body$;
--> statement-breakpoint
CREATE FUNCTION public.c306_recheck_current_purchase(purchase_uuid uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
DECLARE receipt_id uuid;
BEGIN
  FOR receipt_id IN SELECT f.confirmation_id FROM public.investment_sip_confirmed_fills f
    WHERE f.purchase_id=purchase_uuid LOOP
    PERFORM public.c306_recheck_current_confirmation(receipt_id);
  END LOOP;
END
$body$;
--> statement-breakpoint
CREATE FUNCTION public.c306_recheck_dependency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
DECLARE before_row jsonb; after_row jsonb; dependency jsonb; receipt_id uuid;
BEGIN
  IF TG_TABLE_NAME='accounts' AND TG_OP='UPDATE' THEN
    IF (OLD.id,OLD.household_id,OLD.is_private,OLD.owner_user_id,OLD.deleted_at)
      IS NOT DISTINCT FROM (NEW.id,NEW.household_id,NEW.is_private,NEW.owner_user_id,NEW.deleted_at) THEN
      RETURN NULL;
    END IF;
  END IF;
  before_row:=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  after_row:=CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  FOREACH dependency IN ARRAY ARRAY[before_row,after_row] LOOP
    IF TG_TABLE_NAME='audit_logs' THEN
      IF dependency->>'entity_type'='investment_sip_confirmation' THEN
        PERFORM public.c306_recheck_current_confirmation((dependency->>'entity_id')::uuid);
      ELSIF dependency->>'entity_type'='investment_transaction' THEN
        PERFORM public.c306_recheck_current_purchase((dependency->>'entity_id')::uuid);
      END IF;
    ELSIF TG_TABLE_NAME='tax_lots' THEN
      PERFORM public.c306_recheck_current_purchase((dependency->>'transaction_id')::uuid);
    ELSIF TG_TABLE_NAME='investment_sip_confirmed_fills' THEN
      PERFORM public.c306_recheck_current_confirmation((dependency->>'confirmation_id')::uuid);
    ELSIF TG_TABLE_NAME='holdings' THEN
      FOR receipt_id IN SELECT DISTINCT f.confirmation_id FROM public.investment_transactions p
        JOIN public.investment_sip_confirmed_fills f ON f.purchase_id=p.id WHERE p.holding_id=(dependency->>'id')::uuid LOOP
        PERFORM public.c306_recheck_current_confirmation(receipt_id);
      END LOOP;
    ELSIF TG_TABLE_NAME='accounts' THEN
      FOR receipt_id IN SELECT c.id FROM public.investment_sip_confirmations c
        JOIN public.investment_sip_occurrences o ON o.plan_id=c.plan_id AND o.original_due_date=c.original_due_date
        WHERE o.account_id=(dependency->>'id')::uuid AND public.investment_sip_owns_xid(c.xmin) LOOP
        PERFORM public.c306_recheck_current_confirmation(receipt_id);
      END LOOP;
    ELSIF TG_TABLE_NAME='recurring_investments' THEN
      PERFORM public.c306_recheck_current_plan((dependency->>'id')::uuid);
    ELSIF TG_TABLE_NAME='investment_sip_occurrence_fences' THEN
      PERFORM public.c306_recheck_current_plan((dependency->>'plan_id')::uuid);
    END IF;
  END LOOP;
  RETURN NULL;
END
$body$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER c306_audit_dependency AFTER INSERT OR UPDATE OR DELETE ON public.audit_logs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.c306_recheck_dependency();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER c306_lot_dependency AFTER INSERT OR UPDATE OR DELETE ON public.tax_lots
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.c306_recheck_dependency();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER c306_holding_dependency AFTER INSERT OR UPDATE OR DELETE ON public.holdings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.c306_recheck_dependency();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER c306_account_dependency AFTER UPDATE OR DELETE ON public.accounts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.c306_recheck_dependency();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER c306_fill_dependency AFTER UPDATE OR DELETE ON public.investment_sip_confirmed_fills
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.c306_recheck_dependency();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER c306_plan_dependency AFTER UPDATE ON public.recurring_investments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.c306_recheck_dependency();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER c306_fence_dependency AFTER UPDATE ON public.investment_sip_occurrence_fences
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.c306_recheck_dependency();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.c306_recheck_dependency() FROM PUBLIC;
--> statement-breakpoint
-- TRUNCATE has no row events. Keep the same current-transaction scope as the
-- dependency checks, including the mandatory audit for a zero-fill closure.
CREATE FUNCTION public.c306_guard_current_evidence_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF EXISTS(SELECT 1 FROM public.investment_sip_confirmations c
    WHERE public.investment_sip_owns_xid(c.xmin)
      AND (TG_TABLE_NAME='audit_logs' OR c.fill_count>0)) THEN
    RAISE EXCEPTION 'Current confirmation evidence cannot be truncated' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER c306_audit_current_no_truncate BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION public.c306_guard_current_evidence_truncate();
--> statement-breakpoint
CREATE TRIGGER c306_lot_current_no_truncate BEFORE TRUNCATE ON public.tax_lots
  FOR EACH STATEMENT EXECUTE FUNCTION public.c306_guard_current_evidence_truncate();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.c306_guard_current_evidence_truncate() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.c306_deny_occurrence_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  RAISE EXCEPTION 'Investment occurrence state cannot be truncated' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER c306_fence_no_truncate BEFORE TRUNCATE ON public.investment_sip_occurrence_fences
  FOR EACH STATEMENT EXECUTE FUNCTION public.c306_deny_occurrence_truncate();
--> statement-breakpoint
CREATE TRIGGER c306_occurrence_no_truncate BEFORE TRUNCATE ON public.investment_sip_occurrences
  FOR EACH STATEMENT EXECUTE FUNCTION public.c306_deny_occurrence_truncate();
--> statement-breakpoint
CREATE TRIGGER c306_confirmation_no_truncate BEFORE TRUNCATE ON public.investment_sip_confirmations
  FOR EACH STATEMENT EXECUTE FUNCTION public.c306_deny_occurrence_truncate();
--> statement-breakpoint
CREATE TRIGGER c306_fill_no_truncate BEFORE TRUNCATE ON public.investment_sip_confirmed_fills
  FOR EACH STATEMENT EXECUTE FUNCTION public.c306_deny_occurrence_truncate();
