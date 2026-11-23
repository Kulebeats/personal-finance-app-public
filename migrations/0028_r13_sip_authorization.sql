-- UNRELEASED review candidate: metadata refresh and target rehearsal pending.
-- Legacy plans retain NULL authority/revision zero; no actor/grant/proof backfill.
ALTER TABLE public.recurring_investments ADD COLUMN current_authorization_id uuid;
--> statement-breakpoint
ALTER TABLE public.recurring_investments ADD COLUMN authorization_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE public.recurring_investments ADD CONSTRAINT investment_plan_authorization_revision_nonnegative
  CHECK (authorization_revision >= 0);
--> statement-breakpoint
ALTER TABLE public.recurring_investments ADD CONSTRAINT investment_plan_household_identity UNIQUE (id, household_id);
--> statement-breakpoint
CREATE TABLE public.investment_plan_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES public.users(id),
  revision integer NOT NULL CHECK (revision > 0),
  authorization_contract_version smallint NOT NULL CHECK (authorization_contract_version = 1),
  authorization_kind text NOT NULL CHECK (authorization_kind = 'record_only_sip'),
  authorized_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
  security_generation integer NOT NULL CHECK (security_generation >= 0),
  account_id uuid NOT NULL,
  security_id uuid NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0 AND amount::text ~ '^[0-9]+[.][0-9]{2}$'),
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  frequency public.recurring_frequency NOT NULL,
  initial_execution_date date NOT NULL,
  authorized_terms_digest varchar(64) NOT NULL CHECK (authorized_terms_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT investment_authorization_plan_fk FOREIGN KEY (plan_id, household_id)
    REFERENCES public.recurring_investments(id, household_id) ON DELETE CASCADE,
  CONSTRAINT investment_authorization_revision UNIQUE (plan_id, revision),
  CONSTRAINT investment_authorization_pointer_identity UNIQUE (id, plan_id, household_id, revision),
  CONSTRAINT investment_authorization_operation_identity UNIQUE (id, plan_id, household_id, author_user_id)
);
--> statement-breakpoint
ALTER TABLE public.recurring_investments ADD CONSTRAINT investment_plan_current_authorization_fk
  FOREIGN KEY (current_authorization_id, id, household_id, authorization_revision)
  REFERENCES public.investment_plan_authorizations(id, plan_id, household_id, revision);
--> statement-breakpoint
-- Nonpersonal plan lifecycle state survives operational actor/grant purge.
-- Grant INSERT precedes the atomic pointer/counter UPDATE; this FK is immediate.
CREATE FUNCTION public.guard_investment_plan_authorization_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.current_authorization_id IS NOT NULL OR NEW.authorization_revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'New investment plan must start without authorization at revision zero' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.current_authorization_id IS NOT DISTINCT FROM OLD.current_authorization_id
    OR NEW.current_authorization_id IS NULL THEN
    IF NEW.authorization_revision IS DISTINCT FROM OLD.authorization_revision THEN
      RAISE EXCEPTION 'Investment plan authorization revision must remain unchanged' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.authorization_revision=2147483647 THEN
    RAISE EXCEPTION 'Investment plan authorization revision is exhausted' USING ERRCODE='23514';
  END IF;
  IF NEW.authorization_revision IS DISTINCT FROM OLD.authorization_revision+1 THEN
    RAISE EXCEPTION 'Investment plan authorization revision must advance exactly once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER guard_investment_plan_authorization_revision BEFORE INSERT OR UPDATE ON public.recurring_investments
  FOR EACH ROW EXECUTE FUNCTION public.guard_investment_plan_authorization_revision();
--> statement-breakpoint
-- This operational receipt also accommodates a visible pending rollover plan.
-- A null authorization never certifies execution or a SIP completed proof.
CREATE TABLE public.investment_plan_operations (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES public.users(id),
  operation_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'reconfirm')),
  request_version smallint NOT NULL CHECK (request_version = 1),
  request_digest varchar(64) NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  plan_id uuid NOT NULL,
  authorization_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT investment_plan_operation_identity PRIMARY KEY (household_id, actor_user_id, operation_id),
  CONSTRAINT investment_plan_operation_plan_fk FOREIGN KEY (plan_id, household_id)
    REFERENCES public.recurring_investments(id, household_id) ON DELETE CASCADE,
  CONSTRAINT investment_plan_operation_authorization_fk FOREIGN KEY (authorization_id, plan_id, household_id, actor_user_id)
    REFERENCES public.investment_plan_authorizations(id, plan_id, household_id, author_user_id) ON DELETE CASCADE,
  CONSTRAINT investment_plan_operation_create_revision CHECK (action <> 'create' OR expected_revision = 0)
);
--> statement-breakpoint
-- Exactly the seven owner-approved retained columns. No plan/authorization/
-- operation UUID, credential generation, duplicated money/source or JSON.
CREATE TABLE public.investment_purchase_authorization_proofs (
  purchase_id uuid PRIMARY KEY REFERENCES public.investment_transactions(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES public.users(id),
  authorized_at timestamp with time zone NOT NULL,
  authorization_contract_version smallint NOT NULL CHECK (authorization_contract_version = 1),
  authorized_frequency public.recurring_frequency NOT NULL,
  authorized_initial_date date NOT NULL,
  authorized_terms_digest varchar(64) NOT NULL CHECK (authorized_terms_digest ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
-- Operational INSERT-origin witness; not a retained proof field or a durable
-- due-occurrence identity. Actor erasure purges it through its authorization.
CREATE TABLE public.investment_sip_purchase_reservations (
  purchase_id uuid PRIMARY KEY,
  authorization_id uuid NOT NULL REFERENCES public.investment_plan_authorizations(id) ON DELETE CASCADE,
  creation_xid text NOT NULL,
  posting_confirmed boolean NOT NULL DEFAULT false,
  CONSTRAINT investment_sip_reservation_purchase_fk FOREIGN KEY (purchase_id)
    REFERENCES public.investment_transactions(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE INDEX investment_sip_reservation_authorization ON public.investment_sip_purchase_reservations(authorization_id);
--> statement-breakpoint
CREATE INDEX investment_authorization_actor ON public.investment_plan_authorizations(author_user_id);
--> statement-breakpoint
CREATE INDEX investment_plan_operation_actor ON public.investment_plan_operations(actor_user_id);
--> statement-breakpoint
CREATE INDEX investment_purchase_proof_author ON public.investment_purchase_authorization_proofs(author_user_id);
--> statement-breakpoint
CREATE FUNCTION public.guard_investment_plan_authorization() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='DELETE' AND (NOT EXISTS (SELECT 1 FROM public.recurring_investments WHERE id=OLD.plan_id)
    OR NOT EXISTS (SELECT 1 FROM public.households WHERE id=OLD.household_id)
    OR EXISTS (SELECT 1 FROM public.users WHERE id=OLD.author_user_id AND erased_at IS NOT NULL)) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Investment plan authorization is immutable' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER guard_investment_plan_authorization BEFORE UPDATE OR DELETE ON public.investment_plan_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.guard_investment_plan_authorization();
--> statement-breakpoint
CREATE FUNCTION public.guard_investment_plan_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='DELETE' AND (NOT EXISTS (SELECT 1 FROM public.recurring_investments WHERE id=OLD.plan_id)
    OR NOT EXISTS (SELECT 1 FROM public.households WHERE id=OLD.household_id)
    OR EXISTS (SELECT 1 FROM public.users WHERE id=OLD.actor_user_id AND erased_at IS NOT NULL)
    OR (OLD.authorization_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM public.investment_plan_authorizations WHERE id=OLD.authorization_id))) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Investment plan operation is immutable' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER guard_investment_plan_operation BEFORE UPDATE OR DELETE ON public.investment_plan_operations
  FOR EACH ROW EXECUTE FUNCTION public.guard_investment_plan_operation();
--> statement-breakpoint
-- Reuse the established0022/0024 distinction: a backend-owned row xid can
-- seal a reservation only during the real INSERT, including inside a savepoint.
CREATE FUNCTION public.investment_sip_owns_xid(row_xid pg_catalog.xid) RETURNS pg_catalog.bool
LANGUAGE sql VOLATILE SET search_path=pg_catalog, pg_temp AS $body$
  SELECT row_xid=pg_current_xact_id()::pg_catalog.xid OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='transactionid' AND transactionid=row_xid
      AND pid=pg_backend_pid() AND granted AND mode='ExclusiveLock')
$body$;
--> statement-breakpoint
CREATE FUNCTION public.guard_investment_sip_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.creation_xid:=pg_current_xact_id()::text;
    NEW.posting_confirmed:=false;
    IF EXISTS (SELECT 1 FROM public.investment_transactions WHERE id=NEW.purchase_id) THEN
      RAISE EXCEPTION 'SIP reservation must precede a new purchase' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NOT OLD.posting_confirmed AND NEW.posting_confirmed
    AND OLD.creation_xid=pg_current_xact_id()::text
    AND (to_jsonb(OLD)-'posting_confirmed')=(to_jsonb(NEW)-'posting_confirmed')
    AND EXISTS (SELECT 1 FROM public.investment_transactions purchase
      JOIN public.investment_plan_authorizations grant_record ON grant_record.id=OLD.authorization_id
      WHERE purchase.id=OLD.purchase_id AND purchase.type='buy' AND purchase.quantity>0
        AND purchase.household_id=grant_record.household_id AND purchase.account_id=grant_record.account_id
        AND purchase.security_id=grant_record.security_id AND purchase.amount=grant_record.amount
        AND purchase.currency=grant_record.currency AND public.investment_sip_owns_xid(purchase.xmin)) THEN
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND EXISTS (SELECT 1 FROM public.investment_transactions WHERE id=OLD.purchase_id)
    AND NOT EXISTS (SELECT 1 FROM public.investment_purchase_authorization_proofs WHERE purchase_id=OLD.purchase_id) THEN
    RAISE EXCEPTION 'Cannot purge a surviving SIP purchase reservation before completed proof' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' AND (NOT EXISTS (SELECT 1 FROM public.investment_transactions WHERE id=OLD.purchase_id)
    OR NOT EXISTS (SELECT 1 FROM public.investment_plan_authorizations WHERE id=OLD.authorization_id)
    OR EXISTS (SELECT 1 FROM public.investment_plan_authorizations grant_record JOIN public.users author_identity
      ON author_identity.id=grant_record.author_user_id WHERE grant_record.id=OLD.authorization_id AND author_identity.erased_at IS NOT NULL)) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'SIP purchase reservation is immutable' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER guard_investment_sip_reservation BEFORE INSERT OR UPDATE OR DELETE ON public.investment_sip_purchase_reservations
  FOR EACH ROW EXECUTE FUNCTION public.guard_investment_sip_reservation();
--> statement-breakpoint
CREATE FUNCTION public.seal_investment_sip_purchase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  UPDATE public.investment_sip_purchase_reservations SET posting_confirmed=true
    WHERE purchase_id=NEW.id AND creation_xid=pg_current_xact_id()::text;
  RETURN NULL;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER seal_investment_sip_purchase AFTER INSERT ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.seal_investment_sip_purchase();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.seal_investment_sip_purchase() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.require_completed_sip_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  -- A surviving reservation requires proof even before purchase INSERT. A
  -- surviving purchase still requires proof after operational reservation purge.
  -- Only removal of both the abandoned reservation and its purchase releases it.
  IF (EXISTS (SELECT 1 FROM public.investment_sip_purchase_reservations WHERE purchase_id=NEW.purchase_id)
    OR EXISTS (SELECT 1 FROM public.investment_transactions WHERE id=NEW.purchase_id))
    AND NOT EXISTS (SELECT 1 FROM public.investment_purchase_authorization_proofs WHERE purchase_id=NEW.purchase_id) THEN
    RAISE EXCEPTION 'SIP reservation requires a completed new purchase and proof' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END
$body$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER require_completed_sip_reservation AFTER INSERT ON public.investment_sip_purchase_reservations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_completed_sip_reservation();
--> statement-breakpoint
CREATE FUNCTION public.guard_investment_purchase_authorization_proof() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM public.investment_transactions WHERE id=OLD.purchase_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' AND EXISTS (
    SELECT 1 FROM public.investment_transactions purchase
    JOIN public.recurring_investments plan ON plan.household_id=purchase.household_id
    JOIN public.investment_plan_authorizations grant_record ON grant_record.id=plan.current_authorization_id
      AND grant_record.plan_id=plan.id AND grant_record.household_id=plan.household_id
    JOIN public.investment_sip_purchase_reservations reservation ON reservation.purchase_id=purchase.id
      AND reservation.authorization_id=grant_record.id AND reservation.posting_confirmed
      AND reservation.creation_xid=pg_current_xact_id()::text
    JOIN public.accounts custody ON custody.id=purchase.account_id AND custody.household_id=purchase.household_id
    JOIN public.securities instrument ON instrument.id=purchase.security_id
    JOIN public.users author_identity ON author_identity.id=grant_record.author_user_id
    JOIN public.household_members author_membership ON author_membership.user_id=grant_record.author_user_id
      AND author_membership.household_id=plan.household_id
    WHERE purchase.id=NEW.purchase_id AND purchase.type='buy' AND purchase.quantity>0
      AND plan.type='sip' AND plan.is_active AND instrument.type<>'tbill'
      AND grant_record.authorization_kind='record_only_sip'
      AND author_identity.erased_at IS NULL AND author_identity.email_verified
      AND author_identity.security_generation=grant_record.security_generation
      AND author_membership.role IN ('owner','admin','member')
      AND custody.deleted_at IS NULL AND (NOT custody.is_private OR custody.owner_user_id=grant_record.author_user_id)
      AND plan.account_id=grant_record.account_id AND plan.security_id=grant_record.security_id
      AND plan.amount=grant_record.amount AND plan.currency=grant_record.currency AND plan.frequency=grant_record.frequency
      AND instrument.currency=purchase.currency
      AND purchase.account_id=grant_record.account_id AND purchase.security_id=grant_record.security_id
      AND purchase.amount=grant_record.amount AND purchase.currency=grant_record.currency
      AND grant_record.author_user_id=NEW.author_user_id AND grant_record.authorized_at=NEW.authorized_at
      AND grant_record.authorization_contract_version=NEW.authorization_contract_version
      AND grant_record.frequency=NEW.authorized_frequency AND grant_record.initial_execution_date=NEW.authorized_initial_date
      AND grant_record.authorized_terms_digest=NEW.authorized_terms_digest
      AND (SELECT count(*) FROM public.audit_logs unique_effect WHERE unique_effect.entity_id=purchase.id
        AND unique_effect.entity_type='investment_transaction' AND unique_effect.action='CREATE')=1
      AND EXISTS (SELECT 1 FROM public.audit_logs effect_audit WHERE effect_audit.entity_id=purchase.id
        AND effect_audit.entity_type='investment_transaction' AND effect_audit.action='CREATE' AND effect_audit.user_id IS NULL
        AND effect_audit.details->>'actor'='system' AND effect_audit.details->>'trigger'='sip'
        AND effect_audit.details->>'authorizationContractVersion'='1'
        AND effect_audit.details->>'authorizationProofPurchaseId'=purchase.id::text
        AND ((custody.is_private AND effect_audit.household_id IS NULL)
          OR (NOT custody.is_private AND effect_audit.household_id=purchase.household_id)))
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Completed investment authorization proof is unavailable or immutable' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER guard_investment_purchase_authorization_proof BEFORE INSERT OR UPDATE OR DELETE
  ON public.investment_purchase_authorization_proofs
  FOR EACH ROW EXECUTE FUNCTION public.guard_investment_purchase_authorization_proof();
--> statement-breakpoint
CREATE FUNCTION public.guard_investment_purchase_authorization_proof_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  RAISE EXCEPTION 'Completed investment authorization proof cannot be truncated' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER guard_investment_purchase_authorization_proof_truncate
  BEFORE TRUNCATE ON public.investment_purchase_authorization_proofs
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_investment_purchase_authorization_proof_truncate();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_investment_purchase_authorization_proof_truncate() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.guard_proven_investment_purchase() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $body$
DECLARE old_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.investment_sip_purchase_reservations
      WHERE purchase_id=OLD.id AND creation_xid=pg_current_xact_id()::text) THEN
      RAISE EXCEPTION 'Cannot replace a reserved SIP purchase during creation' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.investment_sip_purchase_reservations
      WHERE purchase_id=NEW.id AND creation_xid IS DISTINCT FROM pg_current_xact_id()::text) THEN
      RAISE EXCEPTION 'SIP purchase must belong to its reservation transaction' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  old_id:=OLD.id;
  IF EXISTS (SELECT 1 FROM public.investment_sip_purchase_reservations
    WHERE purchase_id IN (old_id,NEW.id) AND (NOT posting_confirmed OR creation_xid=pg_current_xact_id()::text)) THEN
    RAISE EXCEPTION 'A reserved SIP purchase can only be bound by its real INSERT' USING ERRCODE='23514';
  END IF;
  IF NEW IS DISTINCT FROM OLD AND EXISTS (
    SELECT 1 FROM public.investment_purchase_authorization_proofs WHERE purchase_id=OLD.id
  ) THEN
    RAISE EXCEPTION 'Completed authorized investment purchase is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER guard_proven_investment_purchase BEFORE INSERT OR UPDATE OR DELETE ON public.investment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_proven_investment_purchase();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.guard_proven_investment_purchase() FROM PUBLIC;
