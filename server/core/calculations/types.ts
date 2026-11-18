/**
 * Calculation Engine - Branded Types
 *
 * TypeScript branded types for type safety in financial calculations.
 * Prevents unit confusion (e.g., mixing percentages with money values).
 *
 * @module core/calculations/types
 */

import { CalculationError } from "./errors";

// ============================================================================
// Branded Type Declarations
// ============================================================================

declare const MoneyBrand: unique symbol;
declare const PercentageBrand: unique symbol;
declare const RatioBrand: unique symbol;

/**
 * Branded type representing a monetary amount.
 * Use `toMoney()` to create instances.
 *
 * @example
 * ```ts
 * const income: Money = toMoney(5000);
 * const expenses: Money = toMoney(3000);
 * const net: Money = toMoney(income - expenses);
 * ```
 */
export type Money = number & { readonly [MoneyBrand]: void };

/**
 * Branded type representing a percentage (0-100 scale typically).
 * Use `toPercentage()` to create instances.
 *
 * @example
 * ```ts
 * const rate: Percentage = toPercentage(25.5); // 25.5%
 * ```
 */
export type Percentage = number & { readonly [PercentageBrand]: void };

/**
 * Branded type representing a dimensionless ratio.
 * Use `toRatio()` to create instances.
 *
 * @example
 * ```ts
 * const dti: Ratio = toRatio(0.36); // Debt-to-income ratio of 36%
 * ```
 */
export type Ratio = number & { readonly [RatioBrand]: void };

// ============================================================================
// Type Constructors (with validation)
// ============================================================================

/**
 * Creates a Money value from a number.
 * Validates that the input is a finite number.
 *
 * @param value - The numeric value
 * @returns A branded Money value
 * @throws {CalculationError} If value is not finite (NaN, Infinity)
 *
 * @example
 * ```ts
 * const amount = toMoney(100.50);
 * toMoney(NaN); // Throws CalculationError
 * ```
 */
export function toMoney(value: number): Money {
  if (!Number.isFinite(value)) {
    throw new CalculationError("INVALID_MONEY", { value });
  }
  return value as Money;
}

/**
 * Creates a Percentage value from a number.
 * Validates that the input is a finite number.
 *
 * @param value - The numeric value (typically 0-100)
 * @returns A branded Percentage value
 * @throws {CalculationError} If value is not finite
 *
 * @example
 * ```ts
 * const rate = toPercentage(15.5);
 * toPercentage(Infinity); // Throws CalculationError
 * ```
 */
export function toPercentage(value: number): Percentage {
  if (!Number.isFinite(value)) {
    throw new CalculationError("INVALID_PERCENTAGE", { value });
  }
  return value as Percentage;
}

/**
 * Creates a Ratio value from a number.
 * Validates that the input is a finite number.
 *
 * @param value - The numeric value (typically 0-1 or 0-∞)
 * @returns A branded Ratio value
 * @throws {CalculationError} If value is not finite
 *
 * @example
 * ```ts
 * const dti = toRatio(0.36);
 * toRatio(NaN); // Throws CalculationError
 * ```
 */
export function toRatio(value: number): Ratio {
  if (!Number.isFinite(value)) {
    throw new CalculationError("INVALID_RATIO", { value });
  }
  return value as Ratio;
}

// ============================================================================
// Safe Constructors (return fallback instead of throwing)
// ============================================================================

/**
 * Safely creates a Money value, returning a fallback if invalid.
 *
 * @param value - The numeric value
 * @param fallback - Fallback value if invalid (default: 0)
 * @returns A branded Money value
 */
export function toMoneySafe(value: number, fallback: number = 0): Money {
  if (!Number.isFinite(value)) {
    return fallback as Money;
  }
  return value as Money;
}

/**
 * Safely creates a Percentage value, returning a fallback if invalid.
 *
 * @param value - The numeric value
 * @param fallback - Fallback value if invalid (default: 0)
 * @returns A branded Percentage value
 */
export function toPercentageSafe(
  value: number,
  fallback: number = 0
): Percentage {
  if (!Number.isFinite(value)) {
    return fallback as Percentage;
  }
  return value as Percentage;
}

/**
 * Safely creates a Ratio value, returning a fallback if invalid.
 *
 * @param value - The numeric value
 * @param fallback - Fallback value if invalid (default: 0)
 * @returns A branded Ratio value
 */
export function toRatioSafe(value: number, fallback: number = 0): Ratio {
  if (!Number.isFinite(value)) {
    return fallback as Ratio;
  }
  return value as Ratio;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a valid Money number.
 * Note: This checks if the value COULD be valid Money, not if it IS branded.
 *
 * @param value - The value to check
 * @returns True if the value is a finite number
 */
export function isMoney(value: unknown): value is Money {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Type guard to check if a value is a valid Percentage number.
 *
 * @param value - The value to check
 * @returns True if the value is a finite number
 */
export function isPercentage(value: unknown): value is Percentage {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Type guard to check if a value is a valid Ratio number.
 *
 * @param value - The value to check
 * @returns True if the value is a finite number
 */
export function isRatio(value: unknown): value is Ratio {
  return typeof value === "number" && Number.isFinite(value);
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * A numeric value with its associated currency code.
 */
export interface MoneyWithCurrency {
  amount: Money;
  currency: string;
}

/**
 * A date range for calculations.
 */
export interface DateRange {
  from: string; // ISO 8601 date string
  to: string; // ISO 8601 date string
}

/**
 * Result of a calculation with metadata.
 */
export interface CalculationResult<T> {
  value: T;
  calculatedAt: string;
  parameterVersion?: string;
}

/**
 * Aggregation types for time-based calculations.
 */
export type AggregationType =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "biannual"
  | "annual";

/**
 * Scope for data access in multi-user households.
 */
export type DataScope = "mine" | "household";
