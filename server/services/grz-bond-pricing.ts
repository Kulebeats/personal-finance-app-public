import Decimal from "decimal.js";
import { z } from "zod";

const Price = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

// Varying rate units and rounded years in the legacy calculator cannot describe
// a secondary-market settlement. These inputs are explicitly per K100 or percent.
const decimal = z.string().regex(/^\d{1,13}(?:\.\d{1,8})?$/);
const positive = decimal.refine(value => /[1-9]/.test(value), "Must be positive");
const faceValue = z.string().regex(/^\d{1,13}(?:\.\d{1,2})?$/).pipe(positive);
const quote = z.discriminatedUnion("method", [
  z.object({ method: z.literal("dirty_quote"), faceValue, pricePer100: positive }).strict(),
  z.object({ method: z.literal("clean_quote"), faceValue, pricePer100: positive,
    accruedPer100: decimal }).strict(),
  z.object({ method: z.literal("regular_semiannual_cum_interest"), faceValue,
    annualCouponPercent: decimal, annualYieldPercent: decimal,
    couponPeriodDays: z.number().int().min(180).max(185),
    elapsedDays: z.number().int().nonnegative(), remainingCoupons: z.number().int().min(1).max(100)
  }).strict(),
]).refine(input => input.method !== "regular_semiannual_cum_interest"
  || input.elapsedDays < input.couponPeriodDays, "Settlement must be inside the coupon period");

// Price the full holding in ZMW. Keep the per-K100 quote unrounded until scaled.
// This read-only calculator accepts user inputs and never certifies a market observation.
export function priceGrzBond(input: unknown) {
  const terms = quote.parse(input);
  const scale = new Price(terms.faceValue).div(100);
  const amount = (per100: Decimal) => per100.times(scale).toFixed(2, Decimal.ROUND_HALF_UP);
  if (terms.method === "dirty_quote") {
    return { dirtyPrice: amount(new Price(terms.pricePer100)), cleanPrice: null, accruedInterest: null };
  }
  let accrued: Decimal;
  let full: Decimal;
  if (terms.method === "clean_quote") {
    accrued = new Price(terms.accruedPer100);
    full = new Price(terms.pricePer100).plus(accrued);
  } else {
    const coupon = new Price(terms.annualCouponPercent).div(2);
    const yieldPerPeriod = new Price(terms.annualYieldPercent).div(200);
    const elapsed = new Price(terms.elapsedDays).div(terms.couponPeriodDays);
    const toNext = new Price(1).minus(elapsed);
    accrued = coupon.times(elapsed);
    if (terms.remainingCoupons === 1) {
      // BoZ final-period price uses simple interest over the fraction to redemption.
      full = coupon.plus(100).div(yieldPerPeriod.times(toNext).plus(1));
    } else {
      const factor = yieldPerPeriod.plus(1);
      let cashflows = new Price(100);
      for (let i = 1; i < terms.remainingCoupons; i++) {
        cashflows = cashflows.plus(coupon).div(factor);
      }
      full = cashflows.plus(coupon).div(factor.pow(toNext));
    }
  }
  return { dirtyPrice: amount(full), cleanPrice: amount(full.minus(accrued)), accruedInterest: amount(accrued) };
}
