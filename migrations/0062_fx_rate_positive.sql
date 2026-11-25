-- Guard new writes without changing or scanning historical rows.
ALTER TABLE "fx_rates" ADD CONSTRAINT "chk_fx_rates_positive"
  CHECK ("rate" > 0 AND "rate" < 'Infinity'::numeric) NOT VALID;
