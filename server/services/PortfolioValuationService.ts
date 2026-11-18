import { eq, and, isNull, ne } from "drizzle-orm";
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

interface HoldingMetrics {
  currency: string;
  baseCurrency: string;
  fxRateUsed: number | null;
  currentValueLocal: number;
  currentValueBase: number;
  costBasisBase: number;
  gainLoss: number;
  gainLossPercent: number;
}

interface HouseholdInvestmentValue {
  totalValue: number;
  totalCostBasis: number;
  totalGainLoss: number;
  totalGainLossPercent: number;
  byType: Record<string, number>;
  holdingsCount: number;
}

export class PortfolioValuationService {
  /**
   * Compute metrics for a single holding (value, cost basis, gain/loss)
   */
  computeHoldingMetrics(
    holding: Holding,
    security: Security,
    baseCurrency: string,
    fxRatesByCurrency: Map<string, number>
  ): HoldingMetrics {
    const currency = (security.currency || baseCurrency).toUpperCase();
    const quantity = new Money(holding.quantity ?? 0);
    const currentPrice = new Money(security.currentPrice ?? 0);
    // Use toFullString() to preserve precision in multiplication
    const currentValueLocal = quantity.multiply(currentPrice.toFullString());

    // Determine FX Rate.
    // SCP-321 follow-up: a missing rate FAILS CLOSED (never silently 1, which
    // corrupts portfolio valuation). Self-currency stays at the legitimate 1.
    let fxRate = 1;
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

    // Cost Basis Calculation
    const costBasisLocal = new Money(holding.costBasis ?? 0);
    let costBasisBase: Money;

    if (currency === baseCurrency) {
      costBasisBase = costBasisLocal;
    } else if (baseCurrency === "ZMW" && holding.costBasisZmw) {
      costBasisBase = new Money(holding.costBasisZmw);
    } else if (baseCurrency === "ZMW" && holding.acquisitionFxRate) {
      // P1-1 FIX: Use Number() instead of parseFloat()
      costBasisBase = costBasisLocal.multiply(
        Number(holding.acquisitionFxRate)
      );
    } else {
      costBasisBase = costBasisLocal.multiply(fxRate);
    }

    const currentValueBase = currentValueLocal.multiply(fxRate);
    const gainLoss = currentValueBase.subtract(costBasisBase);
    // Use Money.divide() for precision, only convert to number at the end
    const gainLossPercent = costBasisBase.isZero()
      ? 0
      : gainLoss.divide(costBasisBase.toFullString()).multiply(100).toNumber();

    return {
      currency,
      baseCurrency,
      fxRateUsed: currency === baseCurrency ? 1 : fxRate,
      currentValueLocal: currentValueLocal.toNumber(),
      currentValueBase: currentValueBase.toNumber(),
      costBasisBase: costBasisBase.toNumber(),
      gainLoss: gainLoss.toNumber(),
      gainLossPercent,
    };
  }

  /**
   * Calculate total investment value for a household (Holdings only)
   * Separated by security type.
   */
  async getHouseholdInvestmentValue(
    householdId: string,
    baseCurrency: string
  ): Promise<HouseholdInvestmentValue> {
    const allHoldings = await db
      .select({
        holding: holdings,
        security: securities,
        account: accounts,
      })
      .from(holdings)
      .innerJoin(securities, eq(securities.id, holdings.securityId))
      .innerJoin(accounts, eq(accounts.id, holdings.accountId))
      .where(
        and(
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt),
          ne(accounts.isHidden, true) // Exclude hidden accounts
        )
      );

    if (allHoldings.length === 0) {
      return {
        totalValue: 0,
        totalCostBasis: 0,
        totalGainLoss: 0,
        totalGainLossPercent: 0,
        byType: {},
        holdingsCount: 0,
      };
    }

    // Prepare FX Rates
    const currencies = allHoldings
      .map((h) => h.security.currency)
      .filter((c): c is string => Boolean(c));
    const fxRatesMap = await getLatestFxRates(currencies, baseCurrency);

    let totalValue = new Money(0);
    let totalCostBasis = new Money(0);
    const byType: Record<string, Money> = {};

    for (const { holding, security } of allHoldings) {
      const metrics = this.computeHoldingMetrics(
        holding,
        security,
        baseCurrency,
        fxRatesMap
      );

      totalValue = totalValue.add(metrics.currentValueBase);
      totalCostBasis = totalCostBasis.add(metrics.costBasisBase);

      const typeKey = security.type || "other";
      byType[typeKey] = (byType[typeKey] || new Money(0)).add(
        metrics.currentValueBase
      );
    }

    const totalGainLoss = totalValue.subtract(totalCostBasis);
    // Use Money.divide() for precision, only convert to number at the end
    const totalGainLossPercent = totalCostBasis.isZero()
      ? 0
      : totalGainLoss.divide(totalCostBasis.toFullString()).multiply(100).toNumber();

    // Convert byType Money values to numbers for return
    const byTypeNumbers: Record<string, number> = {};
    for (const [key, value] of Object.entries(byType)) {
      byTypeNumbers[key] = value.toNumber();
    }

    return {
      totalValue: totalValue.toNumber(),
      totalCostBasis: totalCostBasis.toNumber(),
      totalGainLoss: totalGainLoss.toNumber(),
      totalGainLossPercent,
      byType: byTypeNumbers,
      holdingsCount: allHoldings.length,
    };
  }

  /**
   * Calculate value of active GRZ T-Bills (Face Value)
   */
  async getTBillsValue(
    householdId: string,
    baseCurrency: string
  ): Promise<number> {
    // Note: GRZ T-Bills are typically ZMW, but handling future multi-currency support
    const bills = await db
      .select({
        faceValue: grzTBills.faceValue,
        // currency: grzTBills.currency, // Not in schema, assuming ZMW
      })
      .from(grzTBills)
      .where(
        and(
          eq(grzTBills.householdId, householdId),
          eq(grzTBills.status, "active")
        )
      );

    if (bills.length === 0) return 0;

    // Assume ZMW for GRZ T-Bills
    const currency = "ZMW";
    // SCP-321 follow-up: a missing rate FAILS CLOSED (never silently 1, which
    // corrupts the T-bill base-currency total). Self-currency stays at 1.
    let fxRate = 1;
    if (currency !== baseCurrency) {
      const resolved = (await getLatestFxRates([currency], baseCurrency)).get(
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

    let total = new Money(0);
    for (const bill of bills) {
      const faceValue = new Money(bill.faceValue);
      total = total.add(faceValue.multiply(fxRate));
    }
    return total.toNumber();
  }

  /**
   * Calculate total pension value
   */
  async getPensionValue(
    householdId: string,
    baseCurrency: string
  ): Promise<number> {
    const pensions = await db
      .select({
        balance: pensionHoldings.currentBalance,
        // currency: pensionHoldings.currency, // Not in schema, assuming ZMW
      })
      .from(pensionHoldings)
      .where(eq(pensionHoldings.householdId, householdId));

    if (pensions.length === 0) return 0;

    // Assume ZMW for Pensions
    const currency = "ZMW";
    // SCP-321 follow-up: a missing rate FAILS CLOSED (never silently 1, which
    // corrupts the pension base-currency total). Self-currency stays at 1.
    let fxRate = 1;
    if (currency !== baseCurrency) {
      const resolved = (await getLatestFxRates([currency], baseCurrency)).get(
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

    let total = new Money(0);
    for (const pension of pensions) {
      const balance = new Money(pension.balance ?? 0);
      total = total.add(balance.multiply(fxRate));
    }
    return total.toNumber();
  }
}

export const portfolioValuationService = new PortfolioValuationService();
