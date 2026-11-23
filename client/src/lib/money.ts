/**
 * Client-side Money utility for consistent formatting and basic handling.
 * Kept lightweight to avoid heavy dependencies on the client.
 *
 * NOTE: For display purposes, parseFloat is acceptable.
 * For calculations, use parseMoneyString() which uses Decimal for precision.
 */

import Decimal from "decimal.js";
import type { MoneyDto, MoneyValue } from "@shared/money";

// Re-export types for convenience
export type { MoneyDto, MoneyValue } from "@shared/money";

const isMoneyDto = (
  value: MoneyValue | number | null | undefined,
): value is MoneyDto =>
  typeof value === "object" &&
  value !== null &&
  "amount" in value &&
  "currency" in value;

/**
 * Convert MoneyValue to number for display purposes.
 * Safe for formatting but not for financial calculations.
 */
export const toMoneyNumber = (value: MoneyValue | number): number => {
  const decimal = parseMoneyString(
    isMoneyDto(value) ? value.amount : (value as string | number),
  );
  const numericAmount = decimal.toNumber();
  return Number.isFinite(numericAmount) ? numericAmount : 0;
};

/**
 * Parse a money string with precision (TODO-019).
 * Use this for any calculations instead of parseFloat.
 */
export const parseMoneyString = (
  value: string | number | null | undefined,
): Decimal => {
  if (value === null || value === undefined) return new Decimal(0);
  if (typeof value === "number") return new Decimal(value);
  const trimmed = String(value).trim();
  if (!trimmed) return new Decimal(0);
  try {
    return new Decimal(trimmed);
  } catch {
    return new Decimal(0);
  }
};

/**
 * Strict validity check for user-supplied amount strings (CSV imports, forms).
 * Unlike parseMoneyString (which coerces garbage to 0 for resilient display
 * paths), this rejects anything Decimal cannot parse exactly — including
 * partial-numeric strings like "12abc" that parseFloat would accept.
 */
export const isParsableMoneyString = (
  value: string | number | null | undefined,
): boolean => {
  if (value === null || value === undefined) return false;
  const trimmed = String(value).trim();
  if (!trimmed) return false;
  try {
    // Decimal parses "NaN"/"Infinity"; reject them — an amount must be finite.
    return new Decimal(trimmed).isFinite();
  } catch {
    return false;
  }
};

const GROUPED_MONEY_PATTERN =
  /^[+-]?(?:(?:\d+)|(?:\d{1,3}(?:,\d{3})+))(?:\.\d+)?$/;

const normalizeMoneyInput = (
  value: string | number | null | undefined,
): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!GROUPED_MONEY_PATTERN.test(trimmed)) return null;
  return trimmed.replace(/,/g, "");
};

export const parseMoneyInputDecimal = (
  value: string | number | null | undefined,
): Decimal | null => {
  const normalized = normalizeMoneyInput(value);
  if (!normalized || !isParsableMoneyString(normalized)) return null;
  return parseMoneyString(normalized);
};

/**
 * Strictly parse user-entered money input to a number for UI filter/display APIs
 * that still accept numbers. Rejects partial numerics instead of truncating.
 */
export const parseMoneyInputNumber = (
  value: string | number | null | undefined,
): number | null => {
  const amount = parseMoneyInputDecimal(value);
  if (!amount) return null;
  const numericAmount = amount.toNumber();
  return Number.isFinite(numericAmount) ? numericAmount : null;
};

/**
 * Sum heterogeneous money values with Decimal precision.
 * Intended for dashboard/widget aggregations where floats can drift.
 */
export const sumMoneyValues = (
  values: Array<MoneyValue | number | null | undefined>,
): Decimal => {
  return values.reduce((sum, value) => {
    if (value === null || value === undefined) return sum;
    const amount = isMoneyDto(value) ? value.amount : (value as string | number);
    return sum.plus(parseMoneyString(amount));
  }, new Decimal(0));
};

/**
 * Convert any money value (MoneyDto, string, or number) into a Decimal with precision.
 * Use this for comparisons and arithmetic instead of parseFloat / Number.
 */
export const moneyValueToDecimal = (
  value: MoneyValue | number | null | undefined,
): Decimal => {
  const amount = isMoneyDto(value) ? value.amount : value;
  return parseMoneyString(amount);
};

/**
 * A money value averaged over `periods`, in decimal, rounded half up to the cent.
 * Returns a number for display only; `periods` below 1 counts as 1.
 */
export const averageMoneyValue = (
  value: MoneyValue | number | null | undefined,
  periods: number,
): number =>
  moneyValueToDecimal(value)
    .dividedBy(Math.max(periods, 1))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();

/**
 * Subtract one money value from another with Decimal precision.
 * Intended for derived figures (remaining, net) that must keep decimal accuracy.
 */
export const subtractMoneyValues = (
  minuend: MoneyValue | number | null | undefined,
  subtrahend: MoneyValue | number | null | undefined,
): Decimal => {
  return moneyValueToDecimal(minuend).minus(moneyValueToDecimal(subtrahend));
};

/**
 * Calculate rounded percentage progress between two money values.
 * Invalid or non-positive targets report 0 instead of Infinity/NaN.
 */
export const calculateMoneyProgressPercent = (
  current: MoneyValue | number | null | undefined,
  target: MoneyValue | number | null | undefined,
): number => {
  const currentInput = isMoneyDto(current) ? current.amount : current;
  const targetInput = isMoneyDto(target) ? target.amount : target;
  const currentDecimal = parseMoneyInputDecimal(currentInput) ?? new Decimal(0);
  const targetDecimal = parseMoneyInputDecimal(targetInput) ?? new Decimal(0);
  if (!targetDecimal.isFinite() || targetDecimal.lessThanOrEqualTo(0)) {
    return 0;
  }
  const percent = currentDecimal.dividedBy(targetDecimal).times(100);
  return percent.isFinite() ? percent.round().toNumber() : 0;
};

/**
 * Build a 2-decimal MoneyDto from a raw value with Decimal precision.
 * Delegates to sumMoneyDto so the canonical rounding/formatting lives in one place,
 * keeping callers free of parseFloat / toFixed.
 */
export const toMoneyDto = (
  value: MoneyValue | number | null | undefined,
  currency: string = "ZMW",
): MoneyDto => {
  const resolvedCurrency = isMoneyDto(value) ? value.currency : currency;
  const amount = isMoneyDto(value) ? value.amount : value;
  return sumMoneyDto(
    [{ amount: parseMoneyString(amount).toString(), currency: resolvedCurrency }],
    resolvedCurrency,
  );
};

/**
 * Safe comparison functions for money values (TODO-019)
 */
export const isPositive = (value: MoneyValue | number): boolean => {
  const decimal = parseMoneyString(
    isMoneyDto(value) ? value.amount : String(value),
  );
  return decimal.greaterThan(0);
};

export const isNegative = (value: MoneyValue | number): boolean => {
  const decimal = parseMoneyString(
    isMoneyDto(value) ? value.amount : String(value),
  );
  return decimal.lessThan(0);
};

export const isZero = (value: MoneyValue | number): boolean => {
  const decimal = parseMoneyString(
    isMoneyDto(value) ? value.amount : String(value),
  );
  return decimal.isZero();
};

/**
 * Format currency for display, to that currency's own minor units: Intl
 * resolves them per currency (K 42.50, JP¥4,250, KWD 12.500), never rounding
 * to whole units and never forcing two decimals on every currency.
 */
export const formatCurrency = (
  amount: MoneyValue | number,
  currency: string = "ZMW",
  locale: string = "en-ZM",
): string => {
  const resolvedCurrency = isMoneyDto(amount) ? amount.currency : currency;
  const numericAmount = toMoneyNumber(amount);

  if (isNaN(numericAmount)) {
    return "-";
  }
  // FIN-05: a server amount whose unit is unknown carries `currency: null`.
  // Show the number without inventing a currency symbol.
  if (!resolvedCurrency) {
    return formatAmount(numericAmount);
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: resolvedCurrency,
  }).format(numericAmount);
};

/**
 * Format amount without currency symbol
 */
export const formatAmount = (
  amount: MoneyValue | number,
  minimumFractionDigits: number = 2,
  maximumFractionDigits: number = 2,
  locale: string = "en-US", // Default to US locale for plain number formatting usually
): string => {
  const numericAmount = toMoneyNumber(amount);

  if (isNaN(numericAmount)) {
    return "-";
  }

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(numericAmount);
};

// ============================================================================
// MoneyDto Arithmetic Utilities (for calculations without precision loss)
// ============================================================================

/**
 * Sum multiple MoneyDto amounts with precision using Decimal.js.
 * Preserves currency from the first element; assumes all amounts have the same currency.
 */
export const sumMoneyDto = (
  amounts: MoneyDto[],
  defaultCurrency: string = "ZMW",
): MoneyDto => {
  if (amounts.length === 0) {
    return { amount: "0.00", currency: defaultCurrency };
  }

  const currency = amounts[0].currency;
  const total = amounts.reduce((sum, moneyDto) => {
    const value = parseMoneyString(moneyDto.amount);
    return sum.plus(value);
  }, new Decimal(0));

  return {
    amount: total.toFixed(2),
    currency,
  };
};

/**
 * Subtract two MoneyDto amounts with precision.
 * @throws Error if currencies don't match
 */
export const subtractMoneyDto = (a: MoneyDto, b: MoneyDto): MoneyDto => {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }

  const aDecimal = parseMoneyString(a.amount);
  const bDecimal = parseMoneyString(b.amount);
  const result = aDecimal.minus(bDecimal);

  return {
    amount: result.toFixed(2),
    currency: a.currency,
  };
};

/**
 * Compare two MoneyDto amounts.
 * Returns: -1 if a < b, 0 if equal, 1 if a > b
 * @throws Error if currencies don't match
 */
export const compareMoneyDto = (a: MoneyDto, b: MoneyDto): number => {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }

  const aDecimal = parseMoneyString(a.amount);
  const bDecimal = parseMoneyString(b.amount);

  return aDecimal.comparedTo(bDecimal);
};

/**
 * Multiply MoneyDto by a scalar (for percentages, rates, etc.)
 */
export const multiplyMoneyDto = (
  money: MoneyDto,
  multiplier: number,
): MoneyDto => {
  const decimal = parseMoneyString(money.amount);
  const result = decimal.times(multiplier);

  return {
    amount: result.toFixed(2),
    currency: money.currency,
  };
};

/**
 * Check if MoneyDto is zero
 */
export const isZeroMoneyDto = (money: MoneyDto): boolean => {
  const decimal = parseMoneyString(money.amount);
  return decimal.isZero();
};

/**
 * Create a zero MoneyDto with specified currency
 */
export const zeroMoneyDto = (currency: string = "ZMW"): MoneyDto => ({
  amount: "0.00",
  currency,
});
