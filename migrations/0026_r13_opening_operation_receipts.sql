CREATE TABLE "investment_opening_operation_receipts" (
	"household_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"request_version" smallint NOT NULL,
	"request_digest" varchar(64) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"holding_id" uuid NOT NULL,
	"creation_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_opening_operation_identity" PRIMARY KEY("household_id","actor_user_id","operation_id"),
	CONSTRAINT "investment_opening_request_valid" CHECK ("investment_opening_operation_receipts"."request_version"=1 AND "investment_opening_operation_receipts"."request_digest" ~ '^[0-9a-f]{64}$' AND "investment_opening_operation_receipts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "investment_opening_snapshot_identity" CHECK (jsonb_typeof("investment_opening_operation_receipts"."creation_snapshot")='object'
    AND jsonb_typeof("investment_opening_operation_receipts"."creation_snapshot"->'holding')='object'
    AND coalesce("investment_opening_operation_receipts"."creation_snapshot"->'holding'->>'id'="investment_opening_operation_receipts"."holding_id"::text, false)
    AND coalesce("investment_opening_operation_receipts"."creation_snapshot"->'holding'->>'householdId'="investment_opening_operation_receipts"."household_id"::text, false))
);
--> statement-breakpoint
ALTER TABLE "investment_opening_operation_receipts" ADD CONSTRAINT "investment_opening_household_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_opening_operation_receipts" ADD CONSTRAINT "investment_opening_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION public.guard_investment_opening_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='DELETE' AND (NOT EXISTS (SELECT 1 FROM public.households WHERE id=OLD.household_id)
    OR NOT EXISTS (SELECT 1 FROM public.users WHERE id=OLD.actor_user_id)
    OR EXISTS (SELECT 1 FROM public.users WHERE id=OLD.actor_user_id AND erased_at IS NOT NULL)) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Opening operation evidence is immutable' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER guard_investment_opening_receipt BEFORE UPDATE OR DELETE ON public.investment_opening_operation_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_investment_opening_receipt();
