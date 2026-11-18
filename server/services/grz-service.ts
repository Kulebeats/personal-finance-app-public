import {
  addMonths,
  isAfter,
  isBefore,
  isEqual,
  differenceInCalendarDays,
} from "date-fns";
import Decimal from "decimal.js";
import { Money } from "../core/money";

// Constants
// SCP-311: WHT_RATE is a tax fraction (15%), kept as a Decimal so every monetary
// computation that applies it stays in exact decimal arithmetic (no IEEE-754 floats).
export const WHT_RATE_FRACTION = 0.15; // 15% Withholding Tax
const WHT = new Decimal(WHT_RATE_FRACTION);

// Backwards-compatible export for existing callers/tests that reference WHT_RATE.
export const WHT_RATE = WHT_RATE_FRACTION;

// Rates and yields are not money; they are ratios. We still compute them with Decimal
// (the same precision-safe engine that backs Money) and round at the boundary.
const RATE_DECIMALS = 6;

function roundRateDecimal(value: Decimal): number {
  return value.toDecimalPlaces(RATE_DECIMALS, Decimal.ROUND_HALF_UP).toNumber();
}

// Money outputs returned as numbers are fixed to the minor unit (2 dp) at the boundary,
// matching the previous rounding contract while keeping the calculation exact end to end.
function moneyToCents(value: Money): number {
  return new Decimal(value.toString()).toNumber();
}

interface BondScheduleItem {
  paymentDate: Date;
  amount: string;
  paymentType: "coupon" | "principal";
  withholdingTax: string;
}

export function generateBondSchedule(
  purchaseDate: Date,
  maturityDate: Date,
  faceValue: number | string,
  couponRate: number | string, // Annual rate (e.g. 0.14 for 14%)
  options?: { couponFrequency?: number; firstCouponDate?: Date }
): BondScheduleItem[] {
  const schedule: BondScheduleItem[] = [];

  const couponFrequency = options?.couponFrequency ?? 2;
  const frequencyMonths =
    couponFrequency > 0 ? Math.round(12 / couponFrequency) : 6;

  // Period coupon = (Face Value applied with the annual coupon ratio) / periods-per-year.
  // All monetary steps go through Money so the persisted coupon and tax are exact.
  const faceMoney = new Money(faceValue);
  const annualCoupon = faceMoney.multiply(new Decimal(couponRate));
  const periodsPerYear = new Decimal(12).div(frequencyMonths);
  const periodCoupon = annualCoupon.divide(periodsPerYear);
  const couponWht = periodCoupon.multiply(WHT);

  // We assume coupons are paid every X months starting from first coupon date.
  // If not provided, approximate by using purchase date as anchor.
  let currentDate =
    options?.firstCouponDate &&
    (isAfter(options.firstCouponDate, purchaseDate) ||
      isEqual(options.firstCouponDate, purchaseDate))
      ? options.firstCouponDate
      : addMonths(purchaseDate, frequencyMonths);

  while (
    isBefore(currentDate, maturityDate) ||
    isEqual(currentDate, maturityDate)
  ) {
    schedule.push({
      paymentDate: currentDate,
      amount: periodCoupon.toString(),
      paymentType: "coupon",
      withholdingTax: couponWht.toString(),
    });

    currentDate = addMonths(currentDate, frequencyMonths);
  }

  // Government bonds pay principal at maturity. WHT is 0 on principal.
  schedule.push({
    paymentDate: maturityDate,
    amount: faceMoney.toString(),
    paymentType: "principal",
    withholdingTax: "0.00",
  });

  return schedule;
}

export function calculateTBillResults(
  faceValue: number | string,
  purchasePrice: number | string,
  tenorDays: number
) {
  const faceMoney = new Money(faceValue);
  const priceMoney = new Money(purchasePrice);
  const discount = faceMoney.subtract(priceMoney);
  const wht = discount.multiply(WHT);
  const netProceeds = faceMoney.subtract(wht);

  // Annualized Yield (a ratio, not money):
  // Yield = (Discount / Purchase Price) * (365 / Tenor)
  const annualizedYield = new Decimal(discount.toFullString())
    .div(priceMoney.toFullString())
    .times(new Decimal(365).div(tenorDays));

  return {
    discount: moneyToCents(discount),
    wht: moneyToCents(wht),
    netProceeds: moneyToCents(netProceeds),
    annualizedYield: annualizedYield.toNumber(),
  };
}

function normalizeRate(rate: number | string): Decimal {
  const r = new Decimal(rate);
  return r.greaterThan(1) ? r.div(100) : r;
}

function calculate30_360Days(start: Date, end: Date) {
  let d1 = start.getDate();
  let d2 = end.getDate();
  const m1 = start.getMonth() + 1;
  const m2 = end.getMonth() + 1;
  const y1 = start.getFullYear();
  const y2 = end.getFullYear();

  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 === 30) d2 = 30;

  return 360 * (y2 - y1) + 30 * (m2 - m1) + (d2 - d1);
}

export function calculateAccruedInterest(params: {
  faceValue: number | string;
  couponRate: number | string;
  lastCouponDate: Date;
  settlementDate: Date;
  dayCountConvention?: "ACT/365" | "ACT/360" | "30/360";
}) {
  const {
    faceValue,
    couponRate,
    lastCouponDate,
    settlementDate,
    dayCountConvention = "ACT/365",
  } = params;

  const normalizedCouponRate = normalizeRate(couponRate);
  let daysAccrued = 0;
  let yearBasis = 365;

  if (dayCountConvention === "30/360") {
    daysAccrued = calculate30_360Days(lastCouponDate, settlementDate);
    yearBasis = 360;
  } else {
    daysAccrued = differenceInCalendarDays(settlementDate, lastCouponDate);
    yearBasis = dayCountConvention === "ACT/360" ? 360 : 365;
  }

  if (daysAccrued < 0) {
    daysAccrued = 0;
  }

  // Accrued interest is money: face value times the coupon ratio times day fraction.
  const dayFraction = new Decimal(daysAccrued).div(yearBasis);
  const accruedInterest = new Money(faceValue)
    .multiply(normalizedCouponRate)
    .multiply(dayFraction);

  return {
    daysAccrued,
    accruedInterest: moneyToCents(accruedInterest),
    formula: `faceValue x couponRate x (${daysAccrued}/${yearBasis})`,
  };
}

export function calculateBondPriceFromYield(params: {
  faceValue: number | string;
  couponRate: number | string;
  yearsToMaturity: number;
  requiredYield: number | string;
  frequency?: number;
  accruedInterest?: number | string;
}) {
  const {
    faceValue,
    couponRate,
    yearsToMaturity,
    requiredYield,
    frequency = 2,
    accruedInterest = 0,
  } = params;

  const faceMoney = new Money(faceValue);
  const normalizedCouponRate = normalizeRate(couponRate);
  const normalizedYield = normalizeRate(requiredYield);
  const periodsRemaining = new Decimal(yearsToMaturity).times(frequency);
  // Coupon paid each period is money.
  const couponPayment = faceMoney.multiply(normalizedCouponRate).divide(frequency);
  const periodYield = normalizedYield.div(frequency);

  // Present-value factor for coupons (an annuity factor, a pure ratio).
  let pvCoupons: Money;
  if (periodYield.isZero()) {
    pvCoupons = couponPayment.multiply(periodsRemaining);
  } else {
    const onePlus = periodYield.plus(1);
    const annuityFactor = new Decimal(1)
      .minus(onePlus.pow(periodsRemaining.negated()))
      .div(periodYield);
    pvCoupons = couponPayment.multiply(annuityFactor);
  }

  // Present value of the face redemption.
  const discountFactor = periodYield.plus(1).pow(periodsRemaining);
  const pvFace = faceMoney.divide(discountFactor);
  const cleanPrice = pvCoupons.add(pvFace);
  const accrued = new Money(accruedInterest);
  const dirtyPrice = cleanPrice.add(accrued);

  // Current yield is a ratio: annual coupon over clean price.
  const cleanPriceDecimal = new Decimal(cleanPrice.toFullString());
  const currentYield = cleanPriceDecimal.isZero()
    ? new Decimal(0)
    : faceMoney
        .multiply(normalizedCouponRate)
        .amount.div(cleanPriceDecimal);

  return {
    cleanPrice: moneyToCents(cleanPrice),
    accruedInterest: moneyToCents(accrued),
    dirtyPrice: moneyToCents(dirtyPrice),
    currentYield: roundRateDecimal(currentYield),
  };
}

export function calculateYieldToMaturity(params: {
  faceValue: number | string;
  couponRate: number | string;
  yearsToMaturity: number;
  currentPrice: number | string;
  frequency?: number;
}) {
  const {
    faceValue,
    couponRate,
    yearsToMaturity,
    currentPrice,
    frequency = 2,
  } = params;

  const faceMoney = new Money(faceValue);
  const currentPriceMoney = new Money(currentPrice);
  const normalizedCouponRate = normalizeRate(couponRate);
  const periodsRemaining = new Decimal(yearsToMaturity).times(frequency);
  const couponPayment = faceMoney.multiply(normalizedCouponRate).divide(frequency);
  const currentPriceDecimal = new Decimal(currentPriceMoney.toFullString());

  if (couponPayment.isZero()) {
    // Zero-coupon: solve directly. YTM = (Face / Price)^(1/years) - 1.
    const ratio = new Decimal(faceMoney.toFullString()).div(currentPriceDecimal);
    const ytm = ratio.pow(new Decimal(1).div(yearsToMaturity)).minus(1);
    return {
      ytm: roundRateDecimal(ytm),
      currentYield: 0,
    };
  }

  // Price as a function of the candidate yield ratio. Returns a Decimal price.
  const priceFromYield = (yieldRate: Decimal): Decimal => {
    const periodYield = yieldRate.div(frequency);
    let pvCoupons: Decimal;
    if (periodYield.isZero()) {
      pvCoupons = couponPayment.amount.times(periodsRemaining);
    } else {
      const onePlus = periodYield.plus(1);
      const annuityFactor = new Decimal(1)
        .minus(onePlus.pow(periodsRemaining.negated()))
        .div(periodYield);
      pvCoupons = couponPayment.amount.times(annuityFactor);
    }
    const pvFace = faceMoney.amount.div(periodYield.plus(1).pow(periodsRemaining));
    return pvCoupons.plus(pvFace);
  };

  const priceAtZero = priceFromYield(new Decimal(0));
  if (currentPriceDecimal.greaterThanOrEqualTo(priceAtZero)) {
    return {
      ytm: 0,
      currentYield: roundRateDecimal(
        faceMoney.multiply(normalizedCouponRate).amount.div(currentPriceDecimal)
      ),
    };
  }

  let low = new Decimal(0);
  let high = new Decimal(1);
  while (priceFromYield(high).greaterThan(currentPriceDecimal) && high.lessThan(5)) {
    high = high.times(2);
  }

  for (let i = 0; i < 100; i++) {
    const mid = low.plus(high).div(2);
    const price = priceFromYield(mid);
    if (price.greaterThan(currentPriceDecimal)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const ytm = low.plus(high).div(2);
  const currentYield = currentPriceDecimal.isZero()
    ? new Decimal(0)
    : faceMoney.multiply(normalizedCouponRate).amount.div(currentPriceDecimal);

  return {
    ytm: roundRateDecimal(ytm),
    currentYield: roundRateDecimal(currentYield),
  };
}

export function calculateTBillYield(params: {
  faceValue: number | string;
  discountRate: number | string;
  tenorDays: number;
}) {
  const { faceValue, discountRate, tenorDays } = params;
  const faceMoney = new Money(faceValue);
  const normalizedRate = normalizeRate(discountRate);
  const discountFactor = normalizedRate.times(new Decimal(tenorDays).div(360));
  // Purchase price is money: face value reduced by the discount factor.
  const purchasePrice = faceMoney.multiply(new Decimal(1).minus(discountFactor));

  if (purchasePrice.isNegativeOrZero()) {
    throw new Error("Discount rate results in a non-positive price");
  }

  const grossReturn = faceMoney.subtract(purchasePrice);
  const withholdingTax = grossReturn.multiply(WHT);
  const netReturn = grossReturn.subtract(withholdingTax);

  const purchasePriceDecimal = new Decimal(purchasePrice.toFullString());
  const annualizationFactor = new Decimal(360).div(tenorDays);
  const effectiveYield = new Decimal(grossReturn.toFullString())
    .div(purchasePriceDecimal)
    .times(annualizationFactor);
  const netYield = new Decimal(netReturn.toFullString())
    .div(purchasePriceDecimal)
    .times(annualizationFactor);

  return {
    purchasePrice: moneyToCents(purchasePrice),
    grossReturn: moneyToCents(grossReturn),
    effectiveYield: roundRateDecimal(effectiveYield),
    netYield: roundRateDecimal(netYield),
  };
}
