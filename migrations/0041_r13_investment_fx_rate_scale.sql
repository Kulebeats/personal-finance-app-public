-- NEW-21: a foreign investment event stores the dated household rate it was
-- converted at, and household rates carry up to 8 decimal places. Widen the
-- two columns that hold that rate from NUMERIC(10,4) to NUMERIC(18,8).
-- Widening only: every existing value fits, no row is refused, no backfill.
ALTER TABLE "investment_transactions" ALTER COLUMN "fx_rate" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "tax_lots" ALTER COLUMN "acquisition_fx_rate" SET DATA TYPE numeric(18, 8);
