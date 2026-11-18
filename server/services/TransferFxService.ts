/**
 * Transfer FX Service
 *
 * Cross-currency FX validation and calculation logic for transfers.
 * Split from TransferService to maintain LOC limits.
 *
 * @module services/TransferFxService
 */

import { ValidationError } from "../utils/errorHandler";
import { Money, roundMoney } from "../core/money";
import { logger } from "../utils/logger";
import Decimal from "decimal.js";

export interface FxData {
  fxRate: string;
  fxBaseCurrency: string;
  fxQuoteCurrency: string;
  fxTimestamp: Date;
  fxSource: string;
  convertedAmount: string;
  convertedAmountCurrency: string;
}

export interface FxCalculationParams {
  amount: Money;
  fromCurrency: string;
  toCurrency: string;
  baseCurrency: string;
  householdId: string;
  fxRate?: string | null;
  fxSource?: string;
}

/**
 * Validate and calculate FX data for cross-currency transfers
 */
export async function calculateFxData(
  params: FxCalculationParams
): Promise<FxData> {
  const { amount, fromCurrency, toCurrency, baseCurrency, householdId, fxRate, fxSource } = params;

  if (!fxRate) {
    throw new ValidationError(
      "FX rate is required for cross-currency transfers",
      [
        { field: "fxRate", message: `Transfer between ${fromCurrency} and ${toCurrency} requires an FX rate` },
      ]
    );
  }

  // Use Decimal for precise FX arithmetic (CLAUDE.md Money/Arithmetic Rule)
  let fxRateDecimal: Decimal;
  try {
    fxRateDecimal = new Decimal(fxRate);
  } catch {
    throw new ValidationError("FX rate must be a valid number", [
      { field: "fxRate", message: "Invalid FX rate value" },
    ]);
  }

  if (fxRateDecimal.isNaN() || fxRateDecimal.lte(0)) {
    throw new ValidationError("FX rate must be a positive number", [
      { field: "fxRate", message: "Invalid FX rate value" },
    ]);
  }

  // Calculate converted amount in target currency
  const convertedToTargetRaw = new Decimal(amount.toString()).times(fxRateDecimal);
  const convertedToTarget = roundMoney(convertedToTargetRaw, 2);

  // Determine which currency to store the converted amount in
  let convertedAmountBase: string;
  let convertedAmountCurrency: string;

  if (toCurrency === baseCurrency) {
    // Target account is in base currency
    convertedAmountBase = convertedToTarget;
    convertedAmountCurrency = baseCurrency;
  } else if (fromCurrency === baseCurrency) {
    // Source is base currency, store the original amount
    convertedAmountBase = amount.toString();
    convertedAmountCurrency = baseCurrency;
  } else {
    // Neither side is base currency - try to convert to base for consistent reporting
    convertedAmountBase = convertedToTarget;
    convertedAmountCurrency = toCurrency;

    try {
      const { getLatestFxRates } = await import("../core/calculations");
      const fxRatesToBase = await getLatestFxRates(
        [fromCurrency, toCurrency],
        baseCurrency
      );

      const fromToBaseRate = fxRatesToBase.get(fromCurrency);
      const toToBaseRate = fxRatesToBase.get(toCurrency);

      if (fromToBaseRate && fromToBaseRate > 0) {
        const convertedToBase = new Decimal(amount.toString()).times(fromToBaseRate);
        convertedAmountBase = roundMoney(convertedToBase, 2);
        convertedAmountCurrency = baseCurrency;
      } else if (toToBaseRate && toToBaseRate > 0) {
        // Derive from->base using provided from->to fxRate and to->base rate
        const derivedFromToBaseRate = fxRateDecimal.times(toToBaseRate);
        const convertedToBase = new Decimal(amount.toString()).times(derivedFromToBaseRate);
        convertedAmountBase = roundMoney(convertedToBase, 2);
        convertedAmountCurrency = baseCurrency;

        logger.warn("Derived base FX rate for cross-currency transfer", {
          householdId,
          fromCurrency,
          toCurrency,
          baseCurrency,
          providedFxRate: fxRate,
          toToBaseRate,
          derivedFromToBaseRate: derivedFromToBaseRate.toString(),
        });
      } else {
        logger.warn("Missing FX rates for base currency conversion", {
          householdId,
          fromCurrency,
          toCurrency,
          baseCurrency,
          providedFxRate: fxRate,
        });
      }
    } catch (err) {
      logger.warn("FX lookup failed for base currency conversion", {
        householdId,
        fromCurrency,
        toCurrency,
        baseCurrency,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("Cross-currency transfer FX calculated", {
    householdId,
    fromCurrency,
    toCurrency,
    baseCurrency,
    fxRate,
    originalAmount: amount.toString(),
    convertedAmount: convertedAmountBase,
    convertedAmountCurrency,
  });

  return {
    fxRate,
    fxBaseCurrency: fromCurrency,
    fxQuoteCurrency: toCurrency,
    fxTimestamp: new Date(),
    fxSource: fxSource || "manual",
    convertedAmount: convertedAmountBase,
    convertedAmountCurrency,
  };
}

/**
 * Calculate destination amount for cross-currency transfers
 */
export function calculateDestinationAmount(
  amount: Money,
  fxData: FxData | null
): string {
  if (!fxData) {
    return amount.toString();
  }
  return roundMoney(new Decimal(amount.toString()).times(fxData.fxRate), 2);
}
