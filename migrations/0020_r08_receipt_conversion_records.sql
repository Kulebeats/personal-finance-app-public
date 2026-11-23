CREATE TABLE "receipt_conversion_records" (
	"receipt_id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"source_image_hash" varchar(64),
	"request_version" smallint NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	CONSTRAINT "receipt_conversion_records_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "receipt_conversion_valid_request" CHECK ("receipt_conversion_records"."request_version" > 0 AND "receipt_conversion_records"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_conversion_household_image_unique" ON "receipt_conversion_records" USING btree ("household_id","source_image_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "pending_receipts_household_id_id_unique" ON "pending_receipts" USING btree ("household_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_household_id_id_unique" ON "transactions" USING btree ("household_id","id");
--> statement-breakpoint
ALTER TABLE "receipt_conversion_records" ADD CONSTRAINT "receipt_conversion_receipt_fk" FOREIGN KEY ("household_id","receipt_id") REFERENCES "public"."pending_receipts"("household_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "receipt_conversion_records" ADD CONSTRAINT "receipt_conversion_transaction_fk" FOREIGN KEY ("household_id","transaction_id") REFERENCES "public"."transactions"("household_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION public.guard_receipt_conversion_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Receipt conversion evidence cannot be truncated' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT image_hash INTO NEW.source_image_hash FROM public.pending_receipts
      WHERE id = NEW.receipt_id AND household_id = NEW.household_id FOR SHARE;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND (
    NOT EXISTS (SELECT 1 FROM public.households WHERE id = OLD.household_id)
    OR (current_setting('app.erasing_household', true) = OLD.household_id::text
      AND NOT EXISTS (SELECT 1 FROM public.household_members WHERE household_id = OLD.household_id))
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Receipt conversion evidence is immutable' USING ERRCODE = '23514';
END
$body$;
--> statement-breakpoint
CREATE TRIGGER receipt_conversion_evidence_guard
  BEFORE INSERT OR UPDATE OR DELETE ON receipt_conversion_records
  FOR EACH ROW EXECUTE FUNCTION public.guard_receipt_conversion_evidence();
--> statement-breakpoint
CREATE FUNCTION public.guard_converted_receipt_identity() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $body$
BEGIN
  IF (NEW.image_hash IS DISTINCT FROM OLD.image_hash
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key)
    AND EXISTS (SELECT 1 FROM public.receipt_conversion_records WHERE receipt_id = OLD.id)
  THEN
    RAISE EXCEPTION 'Converted receipt upload identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER converted_receipt_identity_guard BEFORE UPDATE ON pending_receipts
  FOR EACH ROW EXECUTE FUNCTION public.guard_converted_receipt_identity();
--> statement-breakpoint
CREATE TRIGGER receipt_conversion_truncate_guard BEFORE TRUNCATE ON public.receipt_conversion_records
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_receipt_conversion_evidence();
