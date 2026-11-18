/**
 * Calculation Engine - Logger
 *
 * Interface for audit logging of financial calculations.
 * Records inputs, outputs, execution time, and context.
 *
 * @module core/calculations/monitor/logger
 */

import { logger as appLogger } from "../../../utils/logger";

export interface CalculationLogEntry {
  functionName: string;
  inputs: Record<string, unknown>;
  output: Record<string, unknown>;
  executionTimeMs: number;
  parameterVersion?: string;
  executionMode?: "standard" | "shadow";
  error?: {
    code: string;
    message: string;
  };
  context?: {
    userId?: string;
    householdId?: string;
    channel?: string;
  };
}

export interface CalculationLogger {
  /**
   * Logs a successful calculation.
   */
  logSuccess(
    functionName: string,
    inputs: Record<string, unknown>,
    output: Record<string, unknown>,
    startTime: number,
    context?: CalculationLogEntry["context"]
  ): Promise<void>;

  /**
   * Logs a failed calculation.
   */
  logError(
    functionName: string,
    inputs: Record<string, unknown>,
    error: Error,
    startTime: number,
    context?: CalculationLogEntry["context"]
  ): Promise<void>;
}

/**
 * Creates a no-op logger for testing or default use.
 */
export function createNoOpLogger(): CalculationLogger {
  return {
    async logSuccess() {},
    async logError() {},
  };
}

/**
 * Creates a database logger.
 * @param db - Database instance (unknown type to avoid circular deps)
 */
export function createDatabaseLogger(db: unknown): CalculationLogger {
  return {
    async logSuccess(fn, inputs, output, startTime, context) {
      if (!db) return; // Fail safely

      const duration = Date.now() - startTime;

      // TODO: Implement with Drizzle ORM when calculation_logs table is added to schema
      // Currently disabled because:
      // 1. calculation_logs table doesn't exist in shared/schema.ts
      // 2. Knex-style API (.insert().into()) doesn't work with Drizzle
      // To re-enable: Add calculation_logs table to schema and use:
      //   await db.insert(calculationLogs).values({...})

      appLogger.info("Calculation logged (not persisted - table missing)", {
        functionName: fn,
        executionTimeMs: duration,
        executionMode: "standard",
      });
    },

    async logError(fn, inputs, error, startTime, context) {
      if (!db) return;

      const duration = Date.now() - startTime;

      // TODO: Implement with Drizzle ORM when calculation_logs table is added to schema
      // See logSuccess() for details

      appLogger.error("Calculation error (not persisted - table missing)", {
        functionName: fn,
        executionTimeMs: duration,
        errorMessage: error.message,
      });
    },
  };
}
