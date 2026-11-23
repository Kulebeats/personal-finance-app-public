import Decimal from "decimal.js";
import { db } from "../db";
import { fxRates } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getLatestFxRates } from "../core/calculations";
import { CalculationError } from "../core/calculations/errors";
import { HttpError } from "../core/errors";
import { Money, toMoneyDto } from "../core/money";
import type { MoneyDto } from "@shared/money";
import type { HouseholdContext } from "../middleware/householdGuard";
import { valueVisibleHoldings, type HoldingReadSession } from "../modules/investments/investmentHoldingRead";
import { logger } from "../utils/logger";

/** Attribution is reported in ZMW: the stored acquisition base (costBasisZmw) is ZMW. */
const BASE_CURRENCY = "ZMW";
const CENTS = 2;

export interface AttributionResult {
  holdingId: string;
  securityName: string;
  symbol: string;
  currency: string;

  // Amounts are ZMW MoneyDto decimal strings, never JSON numbers (defect 10).
  currentValue: MoneyDto;
  costBasis: MoneyDto;
  totalGain: MoneyDto;

  // Attribution
  assetReturn: MoneyDto; // Gain due to price change, at the acquisition rate
  fxReturn: MoneyDto; // Gain due to the rate moving since acquisition
  totalReturnPercent: number;
  assetReturnPercent: number;
  fxReturnPercent: number;
}

/**
 * NEW-21 / INV-04: a foreign holding with a cost but no stored ZMW acquisition
 * base cannot be attributed. Its native cost is never reported as ZMW.
 */
export class AttributionBasisUnavailable extends HttpError {
  readonly statusCode = 422;
  readonly code = "FINANCIAL_DATA_UNAVAILABLE";
  constructor() { super("FX attribution is unavailable because a holding has no recorded ZMW cost basis."); }
}

type VisibleRow = Parameters<Parameters<typeof valueVisibleHoldings>[3]>[0][number];

const cents = (value: Decimal) => value.toDecimalPlaces(CENTS, Decimal.ROUND_HALF_UP);
/** A cent-rounded ZMW amount as its response DTO: a decimal string, never a number. */
const zmwDto = (value: Decimal): MoneyDto => toMoneyDto(cents(value), BASE_CURRENCY);
// decimal.js isPositive() is true for +0, so a zero (gifted) basis would divide by zero.
const percentOf = (part: Decimal, whole: Decimal) =>
  whole.greaterThan(0) ? cents(part.div(whole).times(100)).toNumber() : 0;

function currentRate(currency: string, rates: Map<string, number>): Decimal {
  if (currency === BASE_CURRENCY) return new Decimal(1);
  const rate = rates.get(currency);
  // SCP-321: a missing rate fails closed (422 via the holding read), never 1.
  if (rate === undefined) {
    logger.error("Missing FX rate for attribution", { fromCurrency: currency, toCurrency: BASE_CURRENCY });
    throw new CalculationError("MISSING_FX_RATE", { from: currency, to: BASE_CURRENCY });
  }
  return new Decimal(rate);
}

/** The ZMW cost of the remaining position: the writers' stored base, never the native figure. */
function baseCost(row: VisibleRow, costLocal: Money): Money {
  if (row.security.currency === BASE_CURRENCY) return new Money(costLocal.amount, BASE_CURRENCY);
  if (row.holding.costBasisZmw !== null) return new Money(row.holding.costBasisZmw, BASE_CURRENCY);
  if (costLocal.isZero()) return Money.zero(BASE_CURRENCY);
  throw new AttributionBasisUnavailable();
}

function attribute(row: VisibleRow, rates: Map<string, number>): AttributionResult {
  const { holding, security } = row;
  const currency = security.currency;
  const quantity = new Decimal(holding.quantity);
  const fx = currentRate(currency, rates);
  const costLocal = new Money(holding.costBasis ?? "0", currency);
  const costBase = baseCost(row, costLocal);
  const valueLocal = new Money(security.currentPrice ?? "0", currency).multiply(quantity);
  const exactValue = valueLocal.amount.times(fx);
  // The acquisition rate the stored base implies; with no cost, the gain is all asset return.
  const acquisitionFx = costLocal.isPositive() ? costBase.amount.div(costLocal.amount)
    : holding.acquisitionFxRate !== null ? new Decimal(holding.acquisitionFxRate) : fx;
  const exactGain = exactValue.minus(costBase.amount);
  const exactAsset = valueLocal.subtract(costLocal).amount.times(acquisitionFx);
  // Amounts round half-up once from exact Decimal (#302), and the FX return is
  // the residual, so asset + FX equals the total to the cent.
  const valueBase = cents(exactValue);
  const totalGain = valueBase.minus(costBase.amount);
  const assetReturn = cents(exactAsset);
  return {
    holdingId: holding.id,
    securityName: security.name,
    symbol: security.symbol,
    currency,
    currentValue: zmwDto(valueBase),
    costBasis: zmwDto(costBase.amount),
    totalGain: zmwDto(totalGain),
    assetReturn: zmwDto(assetReturn),
    fxReturn: zmwDto(totalGain.minus(assetReturn)),
    // Percentages come from the exact values, not the rounded cents (#302).
    totalReturnPercent: percentOf(exactGain, costBase.amount),
    assetReturnPercent: percentOf(exactAsset, costBase.amount),
    fxReturnPercent: percentOf(exactGain.minus(exactAsset), costBase.amount),
  };
}

function attributeVisible(caller: HouseholdContext, session: HoldingReadSession,
  filters: { holdingId?: string }): Promise<AttributionResult[]> {
  return valueVisibleHoldings(caller, session, filters, async rows => {
    const open = rows.filter(row => !new Decimal(row.holding.quantity).isZero());
    const currencies = Array.from(new Set(open.map(row => row.security.currency).filter(c => c !== BASE_CURRENCY)));
    const rates = await getLatestFxRates(currencies, BASE_CURRENCY, caller.householdId);
    return open.map(row => attribute(row, rates));
  });
}

export class FXAttributionService {
  /**
   * FX attribution for the caller's visible holdings (Rule 11): Shared accounts
   * and the caller's own private ones, from the same read as the holdings list,
   * valued at the household's price.
   */
  async calculateAttribution(caller: HouseholdContext, session: HoldingReadSession): Promise<AttributionResult[]> {
    return attributeVisible(caller, session, {});
  }

  /**
   * One visible holding's attribution; another member's private holding is not
   * found. A-11: only the requested holding is read, priced and converted.
   */
  async calculateAttributionForHolding(caller: HouseholdContext, session: HoldingReadSession,
    holdingId: string): Promise<AttributionResult | null> {
    const [result] = await attributeVisible(caller, session, { holdingId });
    return result ?? null;
  }

  /**
   * Get historical FX rates for charting
   */
  async getHistoricalFX(
    fromCurrency: string,
    toCurrency: string,
    limit: number = 365
  ): Promise<{ date: string; rate: number }[]> {
    const rates = await db
      .select({
        date: fxRates.date,
        rate: fxRates.rate,
      })
      .from(fxRates)
      .where(
        and(
          eq(fxRates.fromCurrency, fromCurrency),
          eq(fxRates.toCurrency, toCurrency)
        )
      )
      .orderBy(desc(fxRates.date))
      .limit(limit);

    // Return chronological for charts
    return rates.map((r) => ({ date: r.date, rate: Number(r.rate) })).reverse();
  }
}

export const fxAttributionService = new FXAttributionService();
