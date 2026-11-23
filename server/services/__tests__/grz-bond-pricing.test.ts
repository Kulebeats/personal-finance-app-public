import { describe, expect, it } from "vitest";
import { priceGrzBond } from "../grz-bond-pricing";

const regular = { method: "regular_semiannual_cum_interest", faceValue: "100",
  annualCouponPercent: "20", annualYieldPercent: "0", couponPeriodDays: 183,
  elapsedDays: 46, remainingCoupons: 3 };

describe("GRZ secondary-market pricing", () => {
  it("reproduces the Bank of Zambia's K2.51 accrued on K100 (46 of 183 days)", () => {
    expect(priceGrzBond(regular)).toEqual({ dirtyPrice: "130.00", cleanPrice: "127.49", accruedInterest: "2.51" });
  });
  it("discounts two future semiannual cashflows to a coupon date", () => {
    expect(priceGrzBond({ ...regular, faceValue: "1000", annualCouponPercent: "10", annualYieldPercent: "12",
      remainingCoupons: 2, elapsedDays: 0 }).dirtyPrice).toBe("981.67");
  });
  it("uses a simple fractional discount in the final coupon period", () => {
    expect(priceGrzBond({ ...regular, annualYieldPercent: "12", elapsedDays: 91, couponPeriodDays: 182,
      remainingCoupons: 1 })).toEqual({ dirtyPrice: "106.80", cleanPrice: "101.80", accruedInterest: "5.00" });
  });
  it("scales before rounding to ngwee", () => {
    expect(priceGrzBond({ method: "clean_quote", faceValue: "1000", pricePer100: "96.8755",
      accruedPer100: "2.51366" })).toEqual({ dirtyPrice: "993.89", cleanPrice: "968.76", accruedInterest: "25.14" });
  });
  it.each([
    { ...regular, elapsedDays: 183 }, { ...regular, couponPeriodDays: 20 },
    { ...regular, annualYieldPercent: "NaN" }, { ...regular, remainingCoupons: 0 },
    { method: "dirty_quote", pricePer100: "100", faceValue: "1000", accruedPer100: "2.51" },
    { method: "clean_quote", pricePer100: "100", faceValue: "1000" },
    { method: "dirty_quote", pricePer100: "0", faceValue: "1000" },
  ])("refuses incomplete or conflicting terms", (input) => {
    expect(() => priceGrzBond(input)).toThrow();
  });
});
