CREATE TABLE "investment_holding_deletion_receipts" (
  "household_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "holding_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "security_id" uuid NOT NULL,
  "request_version" smallint NOT NULL,
  "request_digest" varchar(64) NOT NULL,
  "effect_digest" varchar(64) NOT NULL,
  "delete_audit_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "investment_holding_deletion_identity" PRIMARY KEY ("household_id","actor_user_id","holding_id"),
  CONSTRAINT "investment_holding_deletion_request_valid" CHECK ("investment_holding_deletion_receipts"."request_version"=1 AND "investment_holding_deletion_receipts"."request_digest" ~ '^[0-9a-f]{64}$' AND "investment_holding_deletion_receipts"."effect_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "investment_holding_deletion_receipts" ADD CONSTRAINT "investment_holding_deletion_household_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "investment_holding_deletion_receipts" ADD CONSTRAINT "investment_holding_deletion_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "investment_holding_deletion_physical_identity" ON "investment_holding_deletion_receipts" USING btree ("household_id","holding_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "investment_holding_deletion_audit_identity" ON "investment_holding_deletion_receipts" USING btree ("delete_audit_id");
--> statement-breakpoint
CREATE FUNCTION public.guard_investment_holding_deletion_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog, pg_temp AS $body$
BEGIN
  IF TG_OP='DELETE' AND (NOT EXISTS (SELECT 1 FROM public.households WHERE id=OLD.household_id)
    OR NOT EXISTS (SELECT 1 FROM public.users WHERE id=OLD.actor_user_id)
    OR EXISTS (SELECT 1 FROM public.users WHERE id=OLD.actor_user_id AND erased_at IS NOT NULL)) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Holding deletion evidence is immutable' USING ERRCODE='23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER guard_investment_holding_deletion_receipt BEFORE UPDATE OR DELETE ON public.investment_holding_deletion_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_investment_holding_deletion_receipt();
