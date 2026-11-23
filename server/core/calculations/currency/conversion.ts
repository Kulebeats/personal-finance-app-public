/**
 * Calculation Engine - Currency Conversion Utilities
 *
 * High-level currency conversion functions for common use cases.
 *
 * @module core/calculations/currency/conversion
 */

import { toMoney, type Money } from "../types";
import type { FXRateService } from "./fxRates";
import { Money as DecimalMoney } from "../../money";
import { CalculationError } from "../errors";
import { logger } from "../../../utils/logger";

/**
 * Converts an amount to the user's display currency.
 *
 * @param fxService - FX rate service instance
 * @param amount - The amount to convert
 * @param fromCurrency - Source currency code
 * @param displayCurrency - Target display currency code
 * @param date - Optional date for historical conversion
 * @returns The converted amount in display currency
 */
export async function convertToDisplayCurrency(
  fxService: FXRateService,
  amount: number,
  fromCurrency: string,
  displayCurrency: string,
  date?: string
): Promise<Money> {
  if (fromCurrency.toUpperCase() === displayCurrency.toUpperCase()) {
    return toMoney(amount);
  }

  return fxService.convert(
    toMoney(amount),
    fromCurrency,
    displayCurrency,
    date
  );
}

/**
 * Converts multiple amounts to display currency in batch.
 * More efficient than converting one at a time.
 *
 * @param fxService - FX rate service instance
 * @param items - Array of items with amount and currency
 * @param displayCurrency - Target display currency
 * @param householdId - Household whose own manual rates apply first (R12)
 * @returns Array of converted amounts
 */
export async function convertBatchToDisplayCurrency(
  fxService: FXRateService,
  items: Array<{ amount: number; currency: string }>,
  displayCurrency: string,
  householdId: string
): Promise<Money[]> {
  // Get unique currencies
  const currencies = Array.from(
    new Set(items.map((i) => i.currency.toUpperCase()))
  );

  // Fetch all rates at once
  const rateMap = await fxService.getLatestRatesMap(
    currencies,
    displayCurrency,
    householdId
  );

  // Add self-rate
  rateMap.set(displayCurrency.toUpperCase(), 1);

  // Convert each item. SCP-321: a missing rate MUST fail closed — never silently
  // use 1, which corrupts multi-currency totals. Rate math uses the Decimal Money
  // class for precision.
  return items.map((item) => {
    const currency = item.currency.toUpperCase();
    const rate = rateMap.get(currency);
    if (rate === undefined) {
      logger.error("Missing FX rate for currency conversion", {
        fromCurrency: currency,
        toCurrency: displayCurrency.toUpperCase(),
      });
      throw new CalculationError(
        "MISSING_FX_RATE",
        { from: currency, to: displayCurrency.toUpperCase() },
        `Exchange rate unavailable for ${currency} -> ${displayCurrency.toUpperCase()}`,
      );
    }
    return toMoney(
      new DecimalMoney(String(item.amount)).multiply(rate).toNumber(),
    );
  });
}

/**
 * Result of a multi-currency aggregation
 */
export interface MultiCurrencyTotal {
  /** Total in display currency */
  total: Money;
  /** Breakdown by original currency */
  breakdown: Array<{
    currency: string;
    originalAmount: number;
    convertedAmount: Money;
    rate: number;
  }>;
}

/**
 * Aggregates amounts from multiple currencies into a single display currency.
 *
 * @param fxService - FX rate service instance
 * @param items - Array of items with amount and currency
 * @param displayCurrency - Target display currency
 * @param householdId - Household whose own manual rates apply first (R12)
 * @returns Total and breakdown by currency
 */
export async function aggregateMultiCurrency(
  fxService: FXRateService,
  items: Array<{ amount: number; currency: string }>,
  displayCurrency: string,
  householdId: string
): Promise<MultiCurrencyTotal> {
  // Get unique currencies
  const currencies = Array.from(
    new Set(items.map((i) => i.currency.toUpperCase()))
  );

  // Fetch all rates at once
  const rateMap = await fxService.getLatestRatesMap(
    currencies,
    displayCurrency,
    householdId
  );

  // Add self-rate
  const displayCurrencyUpper = displayCurrency.toUpperCase();
  rateMap.set(displayCurrencyUpper, 1);

  // Group by currency
  const byCurrency = new Map<string, number>();
  for (const item of items) {
    const currency = item.currency.toUpperCase();
    const current = byCurrency.get(currency) ?? 0;
    byCurrency.set(currency, current + item.amount);
  }

  // Calculate totals. SCP-321: a missing rate FAILS CLOSED (never silently 1).
  // Money math uses the Decimal Money class for precision.
  let totalMoney = DecimalMoney.zero();
  const breakdown: MultiCurrencyTotal["breakdown"] = [];

  for (const [currency, originalAmount] of Array.from(byCurrency.entries())) {
    const rate = rateMap.get(currency);
    if (rate === undefined) {
      logger.error("Missing FX rate for currency aggregation", {
        fromCurrency: currency,
        toCurrency: displayCurrencyUpper,
      });
      throw new CalculationError(
        "MISSING_FX_RATE",
        { from: currency, to: displayCurrencyUpper },
        `Exchange rate unavailable for ${currency} -> ${displayCurrencyUpper}`,
      );
    }
    const converted = new DecimalMoney(String(originalAmount)).multiply(rate);
    totalMoney = totalMoney.add(converted);

    breakdown.push({
      currency,
      originalAmount,
      convertedAmount: toMoney(converted.toNumber()),
      rate,
    });
  }

  return {
    total: toMoney(totalMoney.toNumber()),
    breakdown,
  };
}
