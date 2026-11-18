/**
 * Calculation Engine - Error Types
 *
 * Standardized error types with codes for consistent handling across the calculation engine.
 *
 * @module core/calculations/errors
 */

/**
 * Error codes for calculation errors.
 * Each code represents a specific type of calculation failure.
 */
export type CalculationErrorCode =
  | "INVALID_INPUT"
  | "DIVISION_BY_ZERO"
  | "MISSING_FX_RATE"
  | "INVALID_DATE_RANGE"
  | "INSUFFICIENT_DATA"
  | "PARAMETER_NOT_FOUND"
  | "INVALID_MONEY"
  | "INVALID_PERCENTAGE"
  | "INVALID_RATIO"
  | "INVALID_CURRENCY"
  | "CALCULATION_OVERFLOW"
  | "NEGATIVE_VALUE_NOT_ALLOWED";

/**
 * Context information for calculation errors.
 * Provides additional debugging information.
 */
export interface CalculationErrorContext {
  functionName?: string;
  inputs?: Record<string, unknown>;
  parameterVersion?: string;
  householdId?: string;
  timestamp?: string;
  cause?: Error;
  value?: unknown;
  from?: string;
  to?: string;
  date?: string;
  required?: number;
  provided?: number;
}

/**
 * Custom error class for calculation-related errors.
 *
 * @example
 * ```ts
 * throw new CalculationError('INVALID_MONEY', { value: NaN });
 * throw new CalculationError('MISSING_FX_RATE', { from: 'USD', to: 'ZMW' });
 * ```
 */
export class CalculationError extends Error {
  public readonly code: CalculationErrorCode;
  public readonly context: CalculationErrorContext;

  constructor(
    code: CalculationErrorCode,
    context: CalculationErrorContext = {},
    message?: string
  ) {
    super(message ?? `Calculation error: ${code}`);
    this.name = "CalculationError";
    this.code = code;
    this.context = {
      ...context,
      timestamp: context.timestamp ?? new Date().toISOString(),
    };

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CalculationError);
    }
  }

  /**
   * Converts the error to a JSON-serializable object.
   * Useful for logging and API responses.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    };
  }

  /**
   * Creates a human-readable string representation.
   */
  toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }
}

/**
 * Type guard to check if an error is a CalculationError.
 *
 * @param error - The error to check
 * @returns True if the error is a CalculationError
 */
export function isCalculationError(error: unknown): error is CalculationError {
  return error instanceof CalculationError;
}

/**
 * Helper to wrap unknown errors with CalculationError context.
 *
 * @param error - The original error
 * @param context - Additional context to add
 * @returns A CalculationError with the original error as cause
 */
export function wrapError(
  error: unknown,
  context: CalculationErrorContext = {}
): CalculationError {
  if (isCalculationError(error)) {
    return new CalculationError(error.code, {
      ...error.context,
      ...context,
    });
  }

  const originalError =
    error instanceof Error ? error : new Error(String(error));

  return new CalculationError("INVALID_INPUT", {
    ...context,
    cause: originalError,
  });
}
