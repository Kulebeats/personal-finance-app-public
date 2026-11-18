import { db } from "../db";
import {
  holdings,
  securities,
  fxRates,
  taxLots,
  type Holding,
  type Security,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getLatestFxRates } from "../core/calculations";
import { CalculationError } from "../core/calculations/errors";
import { logger } from "../utils/logger";

interface AttributionResult {
  holdingId: string;
  securityName: string;
  symbol: string;
  currency: string;

  // Values in HOME currency (e.g. ZMW)
  currentValue: number;
  costBasis: number;
  totalGain: number;

  // Attribution
  assetReturn: number; // Gain due to price change (in local currency, converted)
  fxReturn: number; // Gain due to FX change
  totalReturnPercent: number;
  assetReturnPercent: number;
  fxReturnPercent: number;
}

export class FXAttributionService {
  /**
   * Calculate attribution for a specific holding or all holdings
   */
  async calculateAttribution(
    householdId: string,
    baseCurrency: string = "ZMW"
  ): Promise<AttributionResult[]> {
    // Fetch holdings with security details
    const userHoldings = await db.query.holdings.findMany({
      where: eq(holdings.householdId, householdId),
      with: {
        security: true,
      },
    });

    const results: AttributionResult[] = [];

    const holdingIds = userHoldings.map((holding) => holding.id);
    const lotRows = holdingIds.length
      ? await db
          .select()
          .from(taxLots)
          .where(inArray(taxLots.holdingId, holdingIds))
      : [];

    const lotsByHolding = new Map<string, typeof lotRows>();
    for (const lot of lotRows) {
      const list = lotsByHolding.get(lot.holdingId) || [];
      list.push(lot);
      lotsByHolding.set(lot.holdingId, list);
    }

    const currencies = Array.from(
      new Set(
        userHoldings
          .map((holding) => holding.security?.currency || baseCurrency)
          .filter(Boolean)
      )
    );
    // Use centralized calculation engine for FX rates
    const fxRatesMap = await getLatestFxRates(currencies, baseCurrency);

    for (const holding of userHoldings) {
      if (!holding.security) continue;

      const qty = Number(holding.quantity);
      if (qty === 0) continue;

      const sec = holding.security;
      const price = Number(sec.currentPrice || 0);
      // SCP-321 follow-up: a missing rate FAILS CLOSED (never silently 1, which
      // corrupts FX attribution). Self-currency stays at the legitimate 1.
      let currentFx: number;
      if (sec.currency === baseCurrency) {
        currentFx = 1;
      } else {
        const resolved = fxRatesMap.get(sec.currency);
        if (resolved === undefined) {
          logger.error("Missing FX rate for attribution", {
            householdId,
            fromCurrency: sec.currency,
            toCurrency: baseCurrency,
            holdingId: holding.id,
          });
          throw new CalculationError(
            "MISSING_FX_RATE",
            { from: sec.currency, to: baseCurrency, householdId },
            `Exchange rate unavailable for ${sec.currency} -> ${baseCurrency}`,
          );
        }
        currentFx = resolved;
      }

      const lots = lotsByHolding.get(holding.id) || [];
      const costBasisLocalFromLots = lots.reduce(
        (sum, lot) => sum + Number(lot.costBasis),
        0
      );
      const costBasisBaseFromLots = lots.reduce((sum, lot) => {
        const base = lot.costBasisZmw
          ? Number(lot.costBasisZmw)
          : lot.acquisitionFxRate
          ? Number(lot.costBasis) * Number(lot.acquisitionFxRate)
          : 0;
        return sum + base;
      }, 0);

      const costBasisLocal =
        costBasisLocalFromLots > 0
          ? costBasisLocalFromLots
          : Number(holding.costBasis || 0);
      const costBasisBase =
        costBasisBaseFromLots > 0
          ? costBasisBaseFromLots
          : Number(holding.costBasisZmw || costBasisLocal);

      // 1. Current Value
      const currentValueLocal = qty * price;
      const currentValueBase = currentValueLocal * currentFx;

      // 2. Total Gain (Base)
      const totalGainBase = currentValueBase - costBasisBase;
      const totalReturnPercent =
        costBasisBase > 0 ? (totalGainBase / costBasisBase) * 100 : 0;

      // 3. Asset Return Component (Base)
      // Gain due to price change, ignoring FX change (use Original FX)
      // Original FX = costBasisBase / costBasisLocal (if costBasisLocal > 0)
      const acquisitionFx =
        costBasisLocal > 0
          ? costBasisBase / costBasisLocal
          : holding.acquisitionFxRate
          ? Number(holding.acquisitionFxRate)
          : 1;

      // Asset Gain (Local)
      const assetGainLocal = currentValueLocal - costBasisLocal;

      // Asset Gain (Base) = Asset Gain (Local) * Acquisition FX
      // This isolates the performance of the asset itself in its native currency terms, converted at the rate we bought it.
      const assetReturnBase = assetGainLocal * acquisitionFx;

      // 4. FX Return Component (residual)
      // Total = Asset(Base) + FX(Base)
      // So FX = Total - Asset
      const fxReturnBase = totalGainBase - assetReturnBase;

      // Percentages of the TOTAL RETURN? Or Percent of Cost Basis?
      // Usually Percent of Cost Basis decomposed.
      const assetReturnPercent =
        costBasisBase > 0 ? (assetReturnBase / costBasisBase) * 100 : 0;
      const fxReturnPercent =
        costBasisBase > 0 ? (fxReturnBase / costBasisBase) * 100 : 0;

      results.push({
        holdingId: holding.id,
        securityName: sec.name,
        symbol: sec.symbol,
        currency: sec.currency,
        currentValue: Number(currentValueBase.toFixed(2)),
        costBasis: Number(costBasisBase.toFixed(2)),
        totalGain: Number(totalGainBase.toFixed(2)),
        assetReturn: Number(assetReturnBase.toFixed(2)),
        fxReturn: Number(fxReturnBase.toFixed(2)),
        totalReturnPercent: Number(totalReturnPercent.toFixed(2)),
        assetReturnPercent: Number(assetReturnPercent.toFixed(2)),
        fxReturnPercent: Number(fxReturnPercent.toFixed(2)),
      });
    }

    return results;
  }

  /**
   * Calculate attribution for a single holding
   */
  async calculateAttributionForHolding(
    householdId: string,
    holdingId: string,
    baseCurrency: string = "ZMW"
  ): Promise<AttributionResult | null> {
    const list = await this.calculateAttribution(householdId, baseCurrency);
    return list.find((h) => h.holdingId === holdingId) || null;
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
