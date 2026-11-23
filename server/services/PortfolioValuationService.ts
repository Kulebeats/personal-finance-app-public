import { eq, and, getTableColumns, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  securities,
  holdings,
  accounts,
  grzTBills,
  pensionHoldings,
  type Holding,
  type Security,
} from "@shared/schema";
import { logger } from "../utils/logger";
import { getLatestFxRates } from "../core/calculations";
import { CalculationError } from "../core/calculations/errors";
import { Money } from "../core/money";
import { heldTBillPredicate, tbillCarryingValueSql } from "./grz/tbillCarryingValue";
import {
  assertHouseholdSecurityPriceAvailable,
  householdSecurityPriceProjection,
  type HouseholdSecurityPriceSelection,
} from "./investment/householdSecurityPriceRead";

/** Money in its own unit: local in the security currency, the rest in the base. */
export interface HoldingMetrics {
  currency: string;
  baseCurrency: string;
  fxRateUsed: number | null;
  currentValueLocal: Money;
  currentValueBase: Money;
  costBasisBase: Money | null;
  gainLoss: Money | null;
  gainLossPercent: number | null;
}

/** Totals in the base currency, as Money until the response boundary. */
export interface HouseholdInvestmentValue {
  totalValue: Money;
  totalCostBasis: Money | null;
  totalGainLoss: Money | null;
  totalGainLossPercent: number | null;
  byType: Record<string, Money>;
  holdingsCount: number;
}

export type PortfolioHoldingInput = Pick<Holding, "id" | "householdId" | "accountId" | "securityId" |
  "quantity" | "costBasis" | "costBasisZmw" | "acquisitionFxRate" | "acquiredDate"> & { verifiedOpeningRate?: boolean };
export type PortfolioSecurityInput = Pick<Security, "id" | "type" | "currency" | "currentPrice">;

/** Already-authorized rows from one ordinary portfolio read statement. */
export interface PortfolioValuationSource {
  holdings: readonly {
    holding: PortfolioHoldingInput;
    security: PortfolioSecurityInput;
    priceEvidence?: HouseholdSecurityPriceSelection;
  }[];
  bills: readonly { faceValue: string | null }[];
  pensions: readonly { balance: string | null }[];
}

/** Capture callers supply one snapshot; ordinary callers retain the live DB. */
export interface ValuationReadContext {
  /** Existing as-of dates must use the same price selection throughout a read. */
  valuationDate?: string;
  database: Pick<typeof db, "select">;
  getLatestFxRates: (currencies: string[], baseCurrency: string, householdId: string) => Promise<ReadonlyMap<string, number | string>>;
  /** Present only for ordinary actor-scoped reads; absent keeps trusted defaults. */
  accountIds?: string[];
  /** Daily net worth uses current value only and needs no FX for zero exposure. */
  currentValueOnly?: boolean;
  /** Ordinary signed portfolio reads value this captured source, then recheck it. */
  source?: PortfolioValuationSource;
}

/** The ZMW acquisition basis follows the recorded holding or its dated rate. */
function foreignZmwBasis(holding: PortfolioHoldingInput, nativeCost: Money): Money | null {
  if (holding.costBasisZmw !== null) {
    const stored = new Money(holding.costBasisZmw, "ZMW");
    return stored.amount.isFinite() && stored.amount.gte(0) ? stored : null;
  }
  if (new Money(holding.quantity).isZero() && nativeCost.isZero()) return Money.zero("ZMW");
  if (!holding.verifiedOpeningRate || holding.costBasis === null || holding.acquiredDate === null || holding.acquisitionFxRate === null) return null;
  const rate = new Money(holding.acquisitionFxRate).amount;
  return rate.isFinite() && rate.gt(0) && nativeCost.amount.isFinite() && nativeCost.amount.gte(0)
    ? new Money(nativeCost.amount.times(rate), "ZMW")
    : null;
}

function returnPercent(gain: Money, basis: Money): number {
  return basis.isZero() ? 0 : gain.divide(basis.toFullString()).multiply(100).toNumber();
}

export class PortfolioValuationService {
  /**
   * Compute metrics for a single holding (value, cost basis, gain/loss)
   */
  computeHoldingMetrics(
    holding: PortfolioHoldingInput,
    security: PortfolioSecurityInput,
    baseCurrency: string,
    fxRatesByCurrency: ReadonlyMap<string, number | string>
  ): HoldingMetrics {
    const currency = (security.currency || baseCurrency).toUpperCase();
    // Price times the share count, both from their stored decimal strings.
    const currentValueLocal = new Money(security.currentPrice ?? 0, currency).multiply(holding.quantity ?? 0);

    // Determine FX Rate.
    // SCP-321 follow-up: a missing rate FAILS CLOSED (never silently 1, which
    // corrupts portfolio valuation). Self-currency stays at the legitimate 1.
    let fxRate: number | string = 1;
    if (currency !== baseCurrency) {
      const rate = fxRatesByCurrency.get(currency);
      if (rate === undefined) {
        logger.error("Missing FX rate for portfolio valuation", {
          fromCurrency: currency,
          toCurrency: baseCurrency,
          holdingId: holding.id,
        });
        throw new CalculationError(
          "MISSING_FX_RATE",
          { from: currency, to: baseCurrency },
          `Exchange rate unavailable for ${currency} -> ${baseCurrency}`,
        );
      }
      fxRate = rate;
    }

    const costBasisLocal = new Money(holding.costBasis ?? 0, currency);
    const costBasisBase = currency !== baseCurrency && baseCurrency === "ZMW"
      ? foreignZmwBasis(holding, costBasisLocal)
      : new Money(costBasisLocal.amount.times(fxRate), baseCurrency);

    const currentValueBase = new Money(currentValueLocal.amount.times(fxRate), baseCurrency);
    const gainLoss = costBasisBase === null ? null : currentValueBase.subtract(costBasisBase);
    const gainLossPercent = costBasisBase === null || gainLoss === null ? null : returnPercent(gainLoss, costBasisBase);

    return {
      currency,
      baseCurrency,
      fxRateUsed: currency === baseCurrency ? 1 : new Money(fxRate).toNumber(),
      currentValueLocal,
      currentValueBase,
      costBasisBase,
      gainLoss,
      gainLossPercent,
    };
  }

  /**
   * Calculate total investment value for a household (Holdings only)
   * Separated by security type.
   */
  async getHouseholdInvestmentValue(
    householdId: string,
    baseCurrency: string,
    context?: ValuationReadContext,
  ): Promise<HouseholdInvestmentValue> {
    const priceEvidence = householdSecurityPriceProjection({
      householdId,
      securityId: securities.id,
      currency: securities.currency,
      globalReferencePrice: securities.currentPrice,
      valuationDate: context?.valuationDate
        ? sql`${context.valuationDate}::date`
        : sql`(transaction_timestamp() AT TIME ZONE 'UTC')::date`,
    });
    const selectedPrice = sql<string | null>`((${priceEvidence})->>'currentPrice')`;
    const allHoldings = context?.source?.holdings ?? await (context?.database ?? db)
      .select({
        holding: holdings,
        security: { ...getTableColumns(securities), currentPrice: selectedPrice },
        account: accounts,
        priceEvidence,
      })
      .from(holdings)
      .innerJoin(securities, eq(securities.id, holdings.securityId))
      .innerJoin(accounts, eq(accounts.id, holdings.accountId))
      .where(
        and(
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt),
          context?.currentValueOnly ? ne(holdings.quantity, "0") : undefined,
          context?.currentValueOnly
            ? sql`(${selectedPrice} IS NULL OR ${selectedPrice}::numeric <> 0)`
            : undefined,
          ne(accounts.isHidden, true), // Preserve existing economic eligibility.
          context?.accountIds !== undefined ? inArray(holdings.accountId, context.accountIds) : undefined,
          context?.accountIds !== undefined ? eq(holdings.householdId, householdId) : undefined,
        )
      );

    for (const row of allHoldings) {
      if ("priceEvidence" in row && row.priceEvidence) {
        assertHouseholdSecurityPriceAvailable(row.priceEvidence, row.holding.quantity);
      }
    }

    if (allHoldings.length === 0) {
      return {
        totalValue: Money.zero(baseCurrency),
        totalCostBasis: Money.zero(baseCurrency),
        totalGainLoss: Money.zero(baseCurrency),
        totalGainLossPercent: 0,
        byType: {},
        holdingsCount: 0,
      };
    }

    // Prepare FX Rates
    const currencies = allHoldings
      .map((h) => h.security.currency)
      .filter((c): c is string => Boolean(c));
    const fxRatesMap = await (context?.getLatestFxRates ?? getLatestFxRates)(currencies, baseCurrency, householdId);

    let totalValue = Money.zero(baseCurrency);
    let totalCostBasis: Money | null = Money.zero(baseCurrency);
    const byType: Record<string, Money> = {};

    for (const { holding, security } of allHoldings) {
      const metrics = this.computeHoldingMetrics(
        holding,
        security,
        baseCurrency,
        fxRatesMap
      );

      totalValue = totalValue.add(metrics.currentValueBase);
      if (totalCostBasis !== null) {
        totalCostBasis = metrics.costBasisBase === null ? null : totalCostBasis.add(metrics.costBasisBase);
      }

      const typeKey = security.type || "other";
      byType[typeKey] = (byType[typeKey] || Money.zero(baseCurrency)).add(
        metrics.currentValueBase
      );
    }

    const totalGainLoss = totalCostBasis === null ? null : totalValue.subtract(totalCostBasis);
    const totalGainLossPercent = totalCostBasis === null || totalGainLoss === null ? null : returnPercent(totalGainLoss, totalCostBasis);

    return {
      totalValue,
      totalCostBasis,
      totalGainLoss,
      totalGainLossPercent,
      byType,
      holdingsCount: allHoldings.length,
    };
  }

  /**
   * Calculate value of active GRZ T-Bills (Face Value)
   */
  async getTBillsValue(
    householdId: string,
    baseCurrency: string,
    context?: ValuationReadContext,
  ): Promise<Money> {
    // Note: GRZ T-Bills are typically ZMW, but handling future multi-currency support
    const bills = context?.source?.bills ?? await (context?.database ?? db)
      .select({
        // A-36: the carrying value (face less withholding once awaiting receipt).
        faceValue: tbillCarryingValueSql,
      })
      .from(grzTBills)
      .where(
        and(
          eq(grzTBills.householdId, householdId),
          heldTBillPredicate(),
          context?.currentValueOnly ? ne(grzTBills.faceValue, "0") : undefined,
          context?.accountIds !== undefined ? inArray(grzTBills.accountId, context.accountIds) : undefined,
        )
      );

    if (bills.length === 0) return Money.zero(baseCurrency);
    // A-36: a bill without a carrying value is unavailable, never counted as zero.
    const carryingValues = bills.map(bill => bill.faceValue);
    if (!carryingValues.every((value): value is string => value !== null)) {
      logger.error("T-bill carrying value unavailable", { householdId });
      throw new CalculationError("INSUFFICIENT_DATA", { householdId }, "T-bill carrying value unavailable");
    }

    // Assume ZMW for GRZ T-Bills
    const currency = "ZMW";
    // SCP-321 follow-up: a missing rate FAILS CLOSED (never silently 1, which
    // corrupts the T-bill base-currency total). Self-currency stays at 1.
    let fxRate: number | string = 1;
    if (currency !== baseCurrency) {
      const resolved = (await (context?.getLatestFxRates ?? getLatestFxRates)([currency], baseCurrency, householdId)).get(
        currency,
      );
      if (resolved === undefined) {
        logger.error("Missing FX rate for T-bill valuation", {
          householdId,
          fromCurrency: currency,
          toCurrency: baseCurrency,
        });
        throw new CalculationError(
          "MISSING_FX_RATE",
          { from: currency, to: baseCurrency, householdId },
          `Exchange rate unavailable for ${currency} -> ${baseCurrency}`,
        );
      }
      fxRate = resolved;
    }

    let total = Money.zero(baseCurrency);
    for (const value of carryingValues) {
      total = total.add(new Money(value, baseCurrency).multiply(fxRate));
    }
    return total;
  }

  /**
   * Calculate total pension value
   */
  async getPensionValue(
    householdId: string,
    baseCurrency: string,
    context?: ValuationReadContext,
  ): Promise<Money> {
    const pensions = context?.source?.pensions ?? await (context?.database ?? db)
      .select({
        balance: pensionHoldings.currentBalance,
        // currency: pensionHoldings.currency, // Not in schema, assuming ZMW
      })
      .from(pensionHoldings)
      .where(and(eq(pensionHoldings.householdId, householdId),
        context?.currentValueOnly ? ne(pensionHoldings.currentBalance, "0") : undefined,
        context?.accountIds !== undefined ? inArray(pensionHoldings.accountId, context.accountIds) : undefined));

    if (pensions.length === 0) return Money.zero(baseCurrency);

    // Assume ZMW for Pensions
    const currency = "ZMW";
    // SCP-321 follow-up: a missing rate FAILS CLOSED (never silently 1, which
    // corrupts the pension base-currency total). Self-currency stays at 1.
    let fxRate: number | string = 1;
    if (currency !== baseCurrency) {
      const resolved = (await (context?.getLatestFxRates ?? getLatestFxRates)([currency], baseCurrency, householdId)).get(
        currency,
      );
      if (resolved === undefined) {
        logger.error("Missing FX rate for pension valuation", {
          householdId,
          fromCurrency: currency,
          toCurrency: baseCurrency,
        });
        throw new CalculationError(
          "MISSING_FX_RATE",
          { from: currency, to: baseCurrency, householdId },
          `Exchange rate unavailable for ${currency} -> ${baseCurrency}`,
        );
      }
      fxRate = resolved;
    }

    let total = Money.zero(baseCurrency);
    for (const pension of pensions) {
      total = total.add(new Money(pension.balance ?? 0, baseCurrency).multiply(fxRate));
    }
    return total;
  }
}

export const portfolioValuationService = new PortfolioValuationService();
