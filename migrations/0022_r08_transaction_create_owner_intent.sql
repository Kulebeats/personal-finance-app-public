CREATE TABLE "transaction_create_owner_intents" (
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"owner_selected" boolean NOT NULL,
	"selected_owner_id" uuid,
	"operation" text DEFAULT 'ordinary' NOT NULL,
	"posting_confirmed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "transaction_create_operation" CHECK ("transaction_create_owner_intents"."operation" IN ('ordinary','recurring','account_import','grz_coupon')),
	CONSTRAINT "transaction_create_owner_selection" CHECK ("transaction_create_owner_intents"."owner_selected" OR "transaction_create_owner_intents"."selected_owner_id" IS NULL)
);
--> statement-breakpoint
-- The posting reserves its intent before inserting the financial row in the same transaction.
ALTER TABLE "transaction_create_owner_intents" ADD CONSTRAINT "transaction_create_owner_intents_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION public.guard_transaction_create_owner_intent() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
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
    IF NOT OLD.posting_confirmed AND NEW.posting_confirmed
       AND (to_jsonb(OLD) - 'posting_confirmed') = (to_jsonb(NEW) - 'posting_confirmed')
       AND EXISTS (SELECT 1 FROM public.transactions AS t WHERE t.id = NEW.transaction_id
         -- PostgreSQL holds an exclusive transaction-ID lock for each writing
         -- subtransaction. An advisory or relation lock cannot satisfy this proof.
         AND (t.xmin = pg_current_xact_id()::xid OR EXISTS (
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
CREATE TRIGGER transaction_create_owner_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON transaction_create_owner_intents
FOR EACH ROW EXECUTE FUNCTION public.guard_transaction_create_owner_intent();
--> statement-breakpoint
CREATE TRIGGER transaction_create_owner_intent_truncate_guard BEFORE TRUNCATE ON transaction_create_owner_intents
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_transaction_create_owner_intent();
--> statement-breakpoint
CREATE FUNCTION public.check_transaction_create_owner_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
BEGIN
  IF EXISTS (SELECT 1 FROM public.transaction_create_owner_intents AS intent WHERE intent.transaction_id = NEW.id
    AND (intent.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR intent.household_id IS DISTINCT FROM NEW.household_id
      OR (TG_OP = 'INSERT' AND NEW.owner_user_id IS DISTINCT FROM
        CASE WHEN intent.owner_selected THEN intent.selected_owner_id ELSE intent.actor_user_id END))) THEN
    RAISE EXCEPTION 'Original owner evidence does not match posting' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    UPDATE public.transaction_create_owner_intents SET posting_confirmed = true WHERE transaction_id = NEW.id;
  END IF;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER transaction_create_owner_binding AFTER INSERT OR UPDATE OF idempotency_key, household_id ON transactions
FOR EACH ROW EXECUTE FUNCTION public.check_transaction_create_owner_binding();
--> statement-breakpoint
-- A concurrent claimant cannot turn a pre-existing row version into its own
-- INSERT by updating the row after reserving an as-yet-uncommitted ID.
CREATE FUNCTION public.guard_pending_transaction_owner_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
BEGIN
  IF EXISTS (SELECT 1 FROM public.transaction_create_owner_intents WHERE transaction_id IN (NEW.id, OLD.id) AND NOT posting_confirmed) THEN
    RAISE EXCEPTION 'Pending original owner evidence can only be bound by a new posting' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER transaction_pending_owner_update BEFORE UPDATE ON transactions
FOR EACH ROW EXECUTE FUNCTION public.guard_pending_transaction_owner_update();
--> statement-breakpoint
CREATE FUNCTION public.require_transaction_create_owner_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
BEGIN
  IF EXISTS (SELECT 1 FROM public.transaction_create_owner_intents WHERE transaction_id = NEW.transaction_id AND NOT posting_confirmed) THEN
    RAISE EXCEPTION 'Original owner evidence requires the same posting transaction' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$body$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transaction_create_owner_commit_guard AFTER INSERT ON transaction_create_owner_intents
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_transaction_create_owner_binding();
