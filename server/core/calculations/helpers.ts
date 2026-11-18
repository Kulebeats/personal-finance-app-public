/**
 * Calculation Engine - Helper Utilities
 *
 * Common helper functions for number parsing, rounding, and precision arithmetic.
 * These utilities ensure consistent handling of numeric values across all calculations.
 *
 * @module core/calculations/helpers
 */

import Decimal from "decimal.js";
import { CalculationError } from "./errors";

// Configure Decimal.js for financial calculations
Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9,
  toExpPos: 21,
});

// ============================================================================
// Number Parsing
// ============================================================================

/**
 * Safely converts any value to a number, returning a fallback for invalid inputs.
 * Handles all the inconsistent parsing patterns found in the codebase.
 *
 * @param value - The value to convert (string, number, null, undefined, object)
 * @param fallback - The fallback value if conversion fails (default: 0)
 * @returns A finite number
 *
 * @example
 * ```ts
 * toSafeNumber("123.45")     // 123.45
 * toSafeNumber(null)         // 0
 * toSafeNumber(undefined)    // 0
 * toSafeNumber(NaN)          // 0
 * toSafeNumber("invalid")    // 0
 * toSafeNumber("100", 50)    // 100
 * ```
 */
export function toSafeNumber(value: unknown, fallback: number = 0): number {
  // Handle null and undefined
  if (value === null || value === undefined) {
    return fallback;
  }

  // Handle strings
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return fallback;
    }
    // Remove currency symbols and commas for parsing
    const cleaned = trimmed.replace(/[,$£€¥₤₹฿]/g, "").replace(/,/g, "");
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  // Handle numbers
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  // Handle objects with valueOf or toString
  if (typeof value === "object") {
    // Check for Decimal.js instances or similar
    if (
      "toNumber" in value &&
      typeof (value as { toNumber: () => number }).toNumber === "function"
    ) {
      const num = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(num) ? num : fallback;
    }

    // Try valueOf
    const primitive = (value as { valueOf?: () => unknown }).valueOf?.();
    if (typeof primitive === "number" && Number.isFinite(primitive)) {
      return primitive;
    }
  }

  // Try converting to number as last resort
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Parses a string or number to a number, throwing on invalid input.
 * Use this when you need to ensure you have a valid number.
 *
 * @param value - The value to parse
 * @param fieldName - Optional field name for error messages
 * @returns A finite number
 * @throws {CalculationError} If the value cannot be parsed to a finite number
 */
export function parseNumber(value: unknown, fieldName?: string): number {
  const num = toSafeNumber(value, NaN);
  if (!Number.isFinite(num)) {
    throw new CalculationError("INVALID_INPUT", {
      value,
      functionName: fieldName ? `parseNumber(${fieldName})` : "parseNumber",
    });
  }
  return num;
}

// ============================================================================
// Rounding
// ============================================================================

/**
 * Rounds a number to a specified number of decimal places.
 * Uses standard half-up rounding (banker's rounding can be added if needed).
 *
 * @param value - The number to round
 * @param decimals - Number of decimal places (default: 2)
 * @returns The rounded number
 *
 * @example
 * ```ts
 * roundToDecimals(123.456, 2)   // 123.46
 * roundToDecimals(123.454, 2)   // 123.45
 * roundToDecimals(123.455, 2)   // 123.46 (half-up)
 * roundToDecimals(100, 2)       // 100
 * ```
 */
export function roundToDecimals(value: number, decimals: number = 2): number {
  if (!Number.isFinite(value)) {
    return value; // Return NaN/Infinity as-is
  }
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Rounds a number using banker's rounding (round half to even).
 * Required for some financial calculations (e.g., tax in Brazil).
 *
 * @param value - The number to round
 * @param decimals - Number of decimal places (default: 2)
 * @returns The rounded number
 */
export function bankersRound(value: number, decimals: number = 2): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  return new Decimal(value)
    .toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN)
    .toNumber();
}

/**
 * Floors a number to a specified number of decimal places.
 *
 * @param value - The number to floor
 * @param decimals - Number of decimal places (default: 2)
 * @returns The floored number
 */
export function floorToDecimals(value: number, decimals: number = 2): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = Math.pow(10, decimals);
  return Math.floor(value * factor) / factor;
}

/**
 * Ceils a number to a specified number of decimal places.
 *
 * @param value - The number to ceil
 * @param decimals - Number of decimal places (default: 2)
 * @returns The ceiled number
 */
export function ceilToDecimals(value: number, decimals: number = 2): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = Math.pow(10, decimals);
  return Math.ceil(value * factor) / factor;
}

// ============================================================================
// Precision Arithmetic (using Decimal.js)
// ============================================================================

/**
 * Multiplies two numbers with high precision.
 * Use for FX rates, interest calculations, and chains of multiplications.
 *
 * @param a - First operand
 * @param b - Second operand
 * @returns The product with full precision
 *
 * @example
 * ```ts
 * preciseMultiply(0.1, 0.2)  // 0.02 (not 0.020000000000000004)
 * ```
 */
export function preciseMultiply(a: number, b: number): number {
  return new Decimal(a).times(b).toNumber();
}

/**
 * Divides two numbers with high precision.
 *
 * @param a - Dividend
 * @param b - Divisor
 * @returns The quotient with full precision
 * @throws {CalculationError} If divisor is zero
 */
export function preciseDivide(a: number, b: number): number {
  if (b === 0) {
    throw new CalculationError("DIVISION_BY_ZERO", { inputs: { a, b } });
  }
  return new Decimal(a).dividedBy(b).toNumber();
}

/**
 * Adds multiple numbers with high precision.
 *
 * @param values - Numbers to add
 * @returns The sum with full precision
 */
export function preciseAdd(...values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => new Decimal(sum).plus(val).toNumber(), 0);
}

/**
 * Subtracts numbers with high precision.
 *
 * @param a - The minuend
 * @param b - The subtrahend
 * @returns a - b with full precision
 */
export function preciseSubtract(a: number, b: number): number {
  return new Decimal(a).minus(b).toNumber();
}

/**
 * Calculates a percentage of a value with high precision.
 *
 * @param value - The base value
 * @param percentage - The percentage (0-100)
 * @returns The calculated amount
 *
 * @example
 * ```ts
 * precisePercentage(1000, 15)  // 150
 * precisePercentage(1000, 0.5) // 5
 * ```
 */
export function precisePercentage(value: number, percentage: number): number {
  return new Decimal(value).times(percentage).dividedBy(100).toNumber();
}

// ============================================================================
// Comparison Utilities
// ============================================================================

/**
 * Compares two numbers for equality within a tolerance.
 * Useful for comparing floating-point results.
 *
 * @param a - First number
 * @param b - Second number
 * @param tolerance - Maximum allowed difference (default: 0.001)
 * @returns True if the numbers are approximately equal
 */
export function approximatelyEqual(
  a: number,
  b: number,
  tolerance: number = 0.001
): number {
  return Math.abs(a - b) <= tolerance ? 1 : 0;
}

/**
 * Checks if a number is approximately equal to another within a tolerance.
 *
 * @param a - First number
 * @param b - Second number
 * @param tolerance - Maximum allowed difference (default: 0.001)
 * @returns True if approximately equal
 */
export function isApproximatelyEqual(
  a: number,
  b: number,
  tolerance: number = 0.001
): boolean {
  return Math.abs(a - b) <= tolerance;
}

/**
 * Clamps a value between a minimum and maximum.
 *
 * @param value - The value to clamp
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns The clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================================================
// Sign and Absolute Value
// ============================================================================

/**
 * Returns the absolute value of a number.
 *
 * @param value - The number
 * @returns The absolute value
 */
export function abs(value: number): number {
  return Math.abs(value);
}

/**
 * Returns the sign of a number (-1, 0, or 1).
 *
 * @param value - The number
 * @returns -1 for negative, 0 for zero, 1 for positive
 */
export function sign(value: number): number {
  return Math.sign(value);
}

// ============================================================================
// Aggregation Helpers
// ============================================================================

/**
 * Calculates the sum of an array of numbers.
 *
 * @param values - Array of numbers
 * @returns The sum
 */
export function sum(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, val) => acc + toSafeNumber(val), 0);
}

/**
 * Calculates the average of an array of numbers.
 *
 * @param values - Array of numbers
 * @returns The average, or 0 if empty
 */
export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return sum(values) / values.length;
}

/**
 * Calculates the minimum of an array of numbers.
 *
 * @param values - Array of numbers
 * @returns The minimum, or Infinity if empty
 */
export function min(values: number[]): number {
  if (values.length === 0) return Infinity;
  return Math.min(...values.map((v) => toSafeNumber(v, Infinity)));
}

/**
 * Calculates the maximum of an array of numbers.
 *
 * @param values - Array of numbers
 * @returns The maximum, or -Infinity if empty
 */
export function max(values: number[]): number {
  if (values.length === 0) return -Infinity;
  return Math.max(...values.map((v) => toSafeNumber(v, -Infinity)));
}

/**
 * Calculates the standard deviation of an array of numbers.
 *
 * @param values - Array of numbers
 * @returns The standard deviation, or 0 if empty
 */
export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = average(values);
  const squareDiffs = values.map((v) => Math.pow(toSafeNumber(v) - avg, 2));
  return Math.sqrt(average(squareDiffs));
}
