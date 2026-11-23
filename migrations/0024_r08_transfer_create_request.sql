CREATE UNIQUE INDEX "accounts_household_account_key" ON "accounts" USING btree ("household_id","id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_account_household_fk" FOREIGN KEY ("household_id","transfer_account_id") REFERENCES "public"."accounts"("household_id","id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED NOT VALID;--> statement-breakpoint
ALTER TABLE "transaction_create_owner_intents" DROP CONSTRAINT "transaction_create_operation";--> statement-breakpoint
ALTER TABLE "transaction_create_owner_intents" DROP CONSTRAINT "transaction_create_request_digest";--> statement-breakpoint
ALTER TABLE "transaction_create_owner_intents" ADD COLUMN "transfer_group_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction_create_owner_intents" ADD COLUMN "transfer_inflow_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction_create_owner_intents" ADD COLUMN "transfer_creation_xid" text;--> statement-breakpoint
ALTER TABLE "transaction_create_owner_intents" ADD COLUMN "transfer_inflow_confirmed" boolean;--> statement-breakpoint
ALTER TABLE "transaction_create_owner_intents" ADD CONSTRAINT "transaction_create_owner_intents_transfer_inflow_id_transactions_id_fk" FOREIGN KEY ("transfer_inflow_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_create_transfer_group" ON "transaction_create_owner_intents" USING btree ("transfer_group_id") WHERE "transaction_create_owner_intents"."transfer_group_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_create_transfer_inflow" ON "transaction_create_owner_intents" USING btree ("transfer_inflow_id") WHERE "transaction_create_owner_intents"."transfer_inflow_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_create_owner_intents" ADD CONSTRAINT "transaction_create_transfer_pair" CHECK (CASE WHEN "transaction_create_owner_intents"."operation" = 'transfer'
    THEN "transaction_create_owner_intents"."transfer_group_id" IS NOT NULL AND "transaction_create_owner_intents"."transfer_inflow_id" IS NOT NULL AND "transaction_create_owner_intents"."transfer_inflow_id" <> "transaction_create_owner_intents"."transaction_id"
    ELSE "transaction_create_owner_intents"."transfer_group_id" IS NULL AND "transaction_create_owner_intents"."transfer_inflow_id" IS NULL END);--> statement-breakpoint
ALTER TABLE "transaction_create_owner_intents" ADD CONSTRAINT "transaction_create_operation" CHECK ("transaction_create_owner_intents"."operation" IN ('ordinary','recurring','account_import','grz_coupon','transfer'));--> statement-breakpoint
ALTER TABLE "transaction_create_owner_intents" ADD CONSTRAINT "transaction_create_request_digest" CHECK (CASE WHEN "transaction_create_owner_intents"."operation" = 'transfer'
    THEN "transaction_create_owner_intents"."request_digest" IS NOT NULL AND "transaction_create_owner_intents"."request_digest" ~ '^t1:[0-9a-f]{64}$' AND NOT "transaction_create_owner_intents"."owner_selected"
    ELSE "transaction_create_owner_intents"."request_digest" IS NULL OR ("transaction_create_owner_intents"."operation" = 'ordinary' AND "transaction_create_owner_intents"."request_digest" ~ '^v1:[0-9a-f]{64}$') END);
--> statement-breakpoint
-- Savepoint writes can have their own xid. Only a transaction-ID lock held
-- by this backend counts as ownership of that subtransaction.
CREATE FUNCTION public.transfer_creation_owns_xid(row_xid pg_catalog.xid) RETURNS pg_catalog.bool
LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $body$
  SELECT row_xid = pg_catalog.pg_current_xact_id()::pg_catalog.xid OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks WHERE locktype = 'transactionid' AND transactionid = row_xid
      AND pid = pg_catalog.pg_backend_pid() AND granted AND mode = 'ExclusiveLock')
$body$;
--> statement-breakpoint
CREATE FUNCTION public.reserve_new_transfer_inflow() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $body$
BEGIN
  NEW.transfer_creation_xid := pg_catalog.pg_current_xact_id()::pg_catalog.text;
  NEW.transfer_inflow_confirmed := false;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE id = NEW.transfer_inflow_id
      OR (household_id = NEW.household_id AND transfer_transaction_id = NEW.transfer_group_id)) THEN
    RAISE EXCEPTION 'Transfer evidence must precede both original legs' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER transfer_intent_precedes_inflow BEFORE INSERT ON transaction_create_owner_intents
FOR EACH ROW WHEN (NEW.operation = 'transfer') EXECUTE FUNCTION public.reserve_new_transfer_inflow();
--> statement-breakpoint
CREATE FUNCTION public.guard_reserved_transfer_leg() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $body$
DECLARE
  receipt record;
  old_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.transaction_create_owner_intents i
        WHERE i.operation = 'transfer' AND OLD.id IN (i.transaction_id, i.transfer_inflow_id)
          AND i.transfer_creation_xid = pg_catalog.pg_current_xact_id()::pg_catalog.text) THEN
      RAISE EXCEPTION 'Cannot replace a transfer leg during its creation' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN old_id := OLD.id; END IF;
  -- 0002 serializes the two live directions via a household-scoped unique
  -- index. Every newly grouped live row must participate in that index.
  IF NEW.transfer_transaction_id IS NOT NULL AND NEW.deleted_at IS NULL
     AND (NEW.type IS DISTINCT FROM 'transfer' OR NEW.is_transfer_in IS NULL) THEN
    IF TG_OP = 'INSERT' OR (OLD.household_id, OLD.transfer_transaction_id, OLD.deleted_at, OLD.type, OLD.is_transfer_in)
       IS DISTINCT FROM (NEW.household_id, NEW.transfer_transaction_id, NEW.deleted_at, NEW.type, NEW.is_transfer_in) THEN
      RAISE EXCEPTION 'A live transfer group requires a transfer leg with a direction' USING ERRCODE = '23514';
    END IF;
  END IF;
  FOR receipt IN SELECT i.* FROM public.transaction_create_owner_intents i
    WHERE i.operation = 'transfer' AND (i.transaction_id IN (NEW.id, old_id) OR i.transfer_inflow_id IN (NEW.id, old_id)
      OR (i.household_id = NEW.household_id AND i.transfer_group_id = NEW.transfer_transaction_id))
  LOOP
    IF TG_OP = 'INSERT' THEN
      IF NEW.id NOT IN (receipt.transaction_id, receipt.transfer_inflow_id)
         OR receipt.transfer_creation_xid IS DISTINCT FROM pg_catalog.pg_current_xact_id()::pg_catalog.text THEN
        RAISE EXCEPTION 'Cannot replace or extend an attested transfer pair' USING ERRCODE = '23514';
      END IF;
    ELSIF receipt.transfer_creation_xid = pg_catalog.pg_current_xact_id()::pg_catalog.text
      OR (OLD.id, OLD.household_id, OLD.type, OLD.is_transfer_in, OLD.transfer_transaction_id)
         IS DISTINCT FROM (NEW.id, NEW.household_id, NEW.type, NEW.is_transfer_in, NEW.transfer_transaction_id) THEN
      RAISE EXCEPTION 'Cannot rebind an original transfer leg' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER guard_reserved_transfer_leg BEFORE INSERT OR UPDATE OR DELETE ON transactions
FOR EACH ROW EXECUTE FUNCTION public.guard_reserved_transfer_leg();
--> statement-breakpoint
CREATE FUNCTION public.verify_new_transfer_pair() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.transaction_create_owner_intents WHERE transaction_id = NEW.transaction_id)
    THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions o JOIN public.transactions i ON i.id = NEW.transfer_inflow_id
    JOIN public.accounts source_account ON source_account.id = o.account_id AND source_account.household_id = o.household_id
    JOIN public.accounts destination_account ON destination_account.id = i.account_id AND destination_account.household_id = i.household_id
    WHERE o.id = NEW.transaction_id AND o.idempotency_key = NEW.idempotency_key AND i.idempotency_key IS NULL
      AND o.household_id = NEW.household_id AND i.household_id = NEW.household_id
      AND o.owner_user_id = NEW.actor_user_id AND i.owner_user_id = NEW.actor_user_id
      AND o.type = 'transfer' AND i.type = 'transfer' AND o.is_transfer_in IS FALSE AND i.is_transfer_in IS TRUE
      AND o.transfer_transaction_id = NEW.transfer_group_id AND i.transfer_transaction_id = NEW.transfer_group_id
      AND o.account_id <> i.account_id AND o.account_id = i.transfer_account_id AND i.account_id = o.transfer_account_id
      AND o.deleted_at IS NULL AND i.deleted_at IS NULL
      AND (SELECT count(*) FROM public.transactions g WHERE g.household_id = NEW.household_id
        AND g.transfer_transaction_id = NEW.transfer_group_id AND g.deleted_at IS NULL) = 2
      AND EXISTS (SELECT 1 FROM public.transaction_create_owner_intents r WHERE r.transaction_id = o.id
        AND r.posting_confirmed AND r.transfer_inflow_confirmed AND r.transfer_creation_xid = pg_catalog.pg_current_xact_id()::pg_catalog.text)
  ) THEN
    RAISE EXCEPTION 'Transfer evidence requires two new reciprocal legs in one transaction' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$body$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER verify_new_transfer_pair AFTER INSERT ON transaction_create_owner_intents
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.operation = 'transfer')
EXECUTE FUNCTION public.verify_new_transfer_pair();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_transaction_create_owner_intent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.posting_confirmed := false;
    IF EXISTS (SELECT 1 FROM public.transactions WHERE id = NEW.transaction_id) THEN
      RAISE EXCEPTION 'Existing transactions cannot acquire original owner evidence' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  -- Only the genuine posting INSERT can seal a reservation it sees in its own transaction.
  IF TG_OP = 'UPDATE' THEN
    -- Seal the inflow during its real INSERT, while a savepoint still owns
    -- its subtransaction lock. The deferred pair check uses this immutable seal.
    IF OLD.operation = 'transfer' AND OLD.transfer_inflow_confirmed IS FALSE AND NEW.transfer_inflow_confirmed IS TRUE
       AND OLD.transfer_creation_xid = pg_catalog.pg_current_xact_id()::pg_catalog.text
       AND (to_jsonb(OLD) - 'transfer_inflow_confirmed') = (to_jsonb(NEW) - 'transfer_inflow_confirmed')
       AND EXISTS (SELECT 1 FROM public.transactions i WHERE i.id = OLD.transfer_inflow_id
         AND i.type = 'transfer' AND i.is_transfer_in AND i.transfer_transaction_id = OLD.transfer_group_id
         AND i.household_id = OLD.household_id AND i.owner_user_id = OLD.actor_user_id
         AND public.transfer_creation_owns_xid(i.xmin)) THEN
      RETURN NEW;
    END IF;
    IF NOT OLD.posting_confirmed AND NEW.posting_confirmed
       AND (to_jsonb(OLD) - 'posting_confirmed') = (to_jsonb(NEW) - 'posting_confirmed')
       AND EXISTS (SELECT 1 FROM public.transactions AS t WHERE t.id = NEW.transaction_id
         -- PostgreSQL holds an exclusive transaction-ID lock for each writing
         -- subtransaction. An advisory or relation lock cannot satisfy this proof.
         AND (t.xmin = pg_current_xact_id()::pg_catalog.xid OR EXISTS (
           SELECT 1 FROM pg_catalog.pg_locks AS l WHERE l.locktype = 'transactionid'
             AND l.transactionid = t.xmin AND l.pid = pg_backend_pid() AND l.granted AND l.mode = 'ExclusiveLock'))
         AND t.idempotency_key = NEW.idempotency_key
         AND t.household_id = NEW.household_id AND t.owner_user_id IS NOT DISTINCT FROM
           CASE WHEN NEW.owner_selected THEN NEW.selected_owner_id ELSE NEW.actor_user_id END) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.transactions WHERE id = OLD.transaction_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Original transaction owner evidence is immutable' USING ERRCODE = '23514';
END
$body$;
--> statement-breakpoint
CREATE FUNCTION public.seal_new_transfer_inflow() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $body$
BEGIN
  UPDATE public.transaction_create_owner_intents SET transfer_inflow_confirmed = true
    WHERE transfer_inflow_id = NEW.id AND operation = 'transfer'
      AND transfer_creation_xid = pg_catalog.pg_current_xact_id()::pg_catalog.text;
  RETURN NULL;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER seal_new_transfer_inflow AFTER INSERT ON transactions
FOR EACH ROW WHEN (NEW.type = 'transfer' AND NEW.is_transfer_in IS TRUE)
EXECUTE FUNCTION public.seal_new_transfer_inflow();
