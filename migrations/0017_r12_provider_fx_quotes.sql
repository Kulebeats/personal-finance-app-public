CREATE TABLE "provider_fx_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_currency" varchar(3) NOT NULL,
	"to_currency" varchar(3) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"quoted_at" timestamp with time zone NOT NULL,
	"effective_date" date NOT NULL,
	"valid_through" date NOT NULL,
	"rate" numeric(30, 12) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_fx_quote_valid" CHECK (
    "provider_fx_quotes"."rate" > 0 AND "provider_fx_quotes"."rate"::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND isfinite("provider_fx_quotes"."quoted_at") AND isfinite("provider_fx_quotes"."valid_through") AND isfinite("provider_fx_quotes"."recorded_at")
    AND "provider_fx_quotes"."valid_through" BETWEEN "provider_fx_quotes"."effective_date" AND "provider_fx_quotes"."effective_date" + 3
    AND "provider_fx_quotes"."effective_date" = ("provider_fx_quotes"."quoted_at" AT TIME ZONE 'UTC')::date
    AND "provider_fx_quotes"."quoted_at" <= "provider_fx_quotes"."recorded_at"
    AND "provider_fx_quotes"."provider" IN ('yahoo_finance', 'exchangerate_api')
    AND "provider_fx_quotes"."from_currency" ~ '^[A-Z]{3}$' AND "provider_fx_quotes"."to_currency" ~ '^[A-Z]{3}$'
    AND "provider_fx_quotes"."from_currency" <> "provider_fx_quotes"."to_currency"
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_fx_quote_identity" ON "provider_fx_quotes" USING btree ("from_currency","to_currency","provider","quoted_at");--> statement-breakpoint
CREATE INDEX "provider_fx_quote_lookup" ON "provider_fx_quotes" USING btree ("from_currency","to_currency","effective_date");