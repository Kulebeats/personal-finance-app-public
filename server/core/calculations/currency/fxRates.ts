/**
 * Calculation Engine - FX Rate Service
 *
 * Consolidated FX rate service that replaces 5 duplicate implementations:
 * - ReportRepository.getLatestFxRates()
 * - PortfolioValuationService.getLatestFxRates()
 * - GoalService.getLatestFxRates()
 * - GoalAccountAssignmentService.getLatestFxRates()
 * - Investment routes inline queries
 *
 * Features:
 * - In-memory caching with configurable TTL
 * - Currency triangulation through base currency
 * - Historical rate fallback chain
 * - Consistent error handling
 *
 * @module core/calculations/currency/fxRates
 */

import { eq, and, desc, lte } from "drizzle-orm";
import { readLatestFxRates } from "./latest-rates-query";
import { CalculationError } from "../errors";
import { toMoney, type Money } from "../types";
import { roundToDecimals, toSafeNumber } from "../helpers";
import type { db } from "../../../db";
import type { fxRates } from "@shared/schema";

// ============================================================================
// Types
// ============================================================================

/**
 * FX rate data structure
 */
export interface FXRate {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  date: string;
  source: string;
}

/**
 * Cache entry with expiration
 */
interface CacheEntry {
  rate: number;
  expiresAt: number;
}

/**
 * FX service configuration
 */
export interface FXServiceConfig {
  /** Cache TTL in seconds (default: 3600 = 1 hour) */
  cacheTtlSeconds: number;
  /** Days to look back for historical rates (default: 30) */
  fallbackDays: number;
  /** Base currency for triangulation (default: 'USD') */
  baseCurrency: string;
}

/**
 * Default configuration
 */
export const DEFAULT_FX_CONFIG: FXServiceConfig = {
  cacheTtlSeconds: 3600, // 1 hour
  fallbackDays: 30,
  baseCurrency: "USD",
};

// ============================================================================
// Repository Interface
// ============================================================================

/**
 * Data access interface for FX rates.
 * Services should depend on this interface, not the implementation.
 */
export interface FXRateRepository {
  getLatestRate(from: string, to: string): Promise<FXRate | null>;
  getRateForDate(
    from: string,
    to: string,
    date: string
  ): Promise<FXRate | null>;
  getMostRecentRateBefore(
    from: string,
    to: string,
    date: string
  ): Promise<FXRate | null>;
  /** R12: the household's own manual rate first, then the shared row. */
  getLatestRates(
    fromCurrencies: string[],
    to: string,
    householdId: string
  ): Promise<Map<string, number>>;
}

/**
 * Creates an FX rate repository using Drizzle ORM.
 *
 * @param database - Drizzle database instance
 * @param fxRatesTable - The fxRates table schema
 * @returns FXRateRepository implementation
 */
export function createFXRateRepository(
  database: Pick<typeof db, "query" | "select" | "selectDistinctOn">,
  fxRatesTable: typeof fxRates
): FXRateRepository {
  return {
    async getLatestRate(from: string, to: string): Promise<FXRate | null> {
      const result = await database.query.fxRates.findFirst({
        where: and(
          eq(fxRatesTable.fromCurrency, from.toUpperCase()),
          eq(fxRatesTable.toCurrency, to.toUpperCase())
        ),
        orderBy: [desc(fxRatesTable.date)],
      });

      if (!result) return null;

      return {
        fromCurrency: result.fromCurrency,
        toCurrency: result.toCurrency,
        rate: toSafeNumber(result.rate, 1),
        date: result.date,
        source: result.source,
      };
    },

    async getRateForDate(
      from: string,
      to: string,
      date: string
    ): Promise<FXRate | null> {
      const result = await database.query.fxRates.findFirst({
        where: and(
          eq(fxRatesTable.fromCurrency, from.toUpperCase()),
          eq(fxRatesTable.toCurrency, to.toUpperCase()),
          eq(fxRatesTable.date, date)
        ),
      });

      if (!result) return null;

      return {
        fromCurrency: result.fromCurrency,
        toCurrency: result.toCurrency,
        rate: toSafeNumber(result.rate, 1),
        date: result.date,
        source: result.source,
      };
    },

    async getMostRecentRateBefore(
      from: string,
      to: string,
      date: string
    ): Promise<FXRate | null> {
      const result = await database.query.fxRates.findFirst({
        where: and(
          eq(fxRatesTable.fromCurrency, from.toUpperCase()),
          eq(fxRatesTable.toCurrency, to.toUpperCase()),
          lte(fxRatesTable.date, date)
        ),
        orderBy: [desc(fxRatesTable.date)],
      });

      if (!result) return null;

      return {
        fromCurrency: result.fromCurrency,
        toCurrency: result.toCurrency,
        rate: toSafeNumber(result.rate, 1),
        date: result.date,
        source: result.source,
      };
    },

    async getLatestRates(
      fromCurrencies: string[],
      to: string,
      householdId: string
    ): Promise<Map<string, number>> {
      return readLatestFxRates(database, fxRatesTable, fromCurrencies, to, householdId);
    },
  };
}

// ============================================================================
// Service Interface
// ============================================================================

/**
 * FX Rate Service interface.
 * All services should depend on this interface for FX operations.
 */
export interface FXRateService {
  /**
   * Get the latest exchange rate between two currencies.
   * @param from - Source currency code (e.g., 'USD')
   * @param to - Target currency code (e.g., 'ZMW')
   * @returns The exchange rate
   * @throws {CalculationError} If rate not found
   */
  getLatestRate(from: string, to: string): Promise<number>;

  /**
   * Get a historical exchange rate for a specific date.
   * Falls back to most recent rate before the date if exact match not found.
   * @param from - Source currency code
   * @param to - Target currency code
   * @param date - ISO date string (YYYY-MM-DD)
   * @returns The exchange rate
   * @throws {CalculationError} If rate not found within fallback window
   */
  getHistoricalRate(from: string, to: string, date: string): Promise<number>;

  /**
   * Convert an amount from one currency to another.
   * @param amount - The amount to convert
   * @param from - Source currency code
   * @param to - Target currency code
   * @param date - Optional date for historical conversion
   * @returns The converted amount
   */
  convert(
    amount: Money,
    from: string,
    to: string,
    date?: string
  ): Promise<Money>;

  /**
   * Get rate with automatic triangulation through base currency.
   * Tries: direct rate → inverse rate → triangulation
   * @param from - Source currency code
   * @param to - Target currency code
   * @param baseCurrency - Triangulation currency (default: 'USD')
   * @returns The exchange rate
   */
  getRateWithTriangulation(
    from: string,
    to: string,
    baseCurrency?: string
  ): Promise<number>;

  /**
   * Get latest rates for multiple currencies at once.
   * More efficient than calling getLatestRate multiple times.
   * @param fromCurrencies - Array of source currency codes
   * @param to - Target currency code
   * @param householdId - Household whose own manual rates apply first (R12)
   * @returns Map of currency code to rate
   */
  getLatestRatesMap(
    fromCurrencies: string[],
    to: string,
    householdId: string
  ): Promise<Map<string, number>>;

  /**
   * Clear the rate cache. Useful for testing or after rate imports.
   */
  clearCache(): void;

  /**
   * Get cache statistics for monitoring.
   */
  getCacheStats(): { size: number; hits: number; misses: number };
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Creates an FX Rate Service with caching and triangulation support.
 *
 * @param repository - Data access layer for FX rates
 * @param config - Service configuration
 * @returns FXRateService implementation
 *
 * @example
 * ```ts
 * const fxService = createFXRateService(
 *   createFXRateRepository(db, fxRates),
 *   { cacheTtlSeconds: 3600, fallbackDays: 30, baseCurrency: 'USD' }
 * );
 *
 * const rate = await fxService.getLatestRate('USD', 'ZMW');
 * const amount = await fxService.convert(toMoney(100), 'USD', 'ZMW');
 * ```
 */
export function createFXRateService(
  repository: FXRateRepository,
  config: FXServiceConfig = DEFAULT_FX_CONFIG
): FXRateService {
  // In-memory cache
  const cache = new Map<string, CacheEntry>();
  let cacheHits = 0;
  let cacheMisses = 0;

  // Helper to generate cache keys
  const getCacheKey = (from: string, to: string, date?: string): string =>
    `fx:${from.toUpperCase()}:${to.toUpperCase()}${date ? `:${date}` : ""}`;

  return {
    async getLatestRate(from: string, to: string): Promise<number> {
      const fromUpper = from.toUpperCase();
      const toUpper = to.toUpperCase();

      // Same currency = 1
      if (fromUpper === toUpper) {
        return 1;
      }

      // Check cache
      const cacheKey = getCacheKey(from, to);
      const cached = cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        cacheHits++;
        return cached.rate;
      }
      cacheMisses++;

      // Fetch from repository
      const rate = await repository.getLatestRate(from, to);
      if (!rate) {
        throw new CalculationError("MISSING_FX_RATE", {
          from: fromUpper,
          to: toUpper,
        });
      }

      // Cache result
      cache.set(cacheKey, {
        rate: rate.rate,
        expiresAt: Date.now() + config.cacheTtlSeconds * 1000,
      });

      return rate.rate;
    },

    async getHistoricalRate(
      from: string,
      to: string,
      date: string
    ): Promise<number> {
      const fromUpper = from.toUpperCase();
      const toUpper = to.toUpperCase();

      // Same currency = 1
      if (fromUpper === toUpper) {
        return 1;
      }

      // Try exact date first
      let rate = await repository.getRateForDate(from, to, date);
      if (rate) {
        return rate.rate;
      }

      // Fallback: most recent rate before date
      rate = await repository.getMostRecentRateBefore(from, to, date);
      if (rate) {
        return rate.rate;
      }

      throw new CalculationError("MISSING_FX_RATE", {
        from: fromUpper,
        to: toUpper,
        date,
      });
    },

    async convert(
      amount: Money,
      from: string,
      to: string,
      date?: string
    ): Promise<Money> {
      const fromUpper = from.toUpperCase();
      const toUpper = to.toUpperCase();

      // Same currency = no conversion
      if (fromUpper === toUpper) {
        return amount;
      }

      const rate = date
        ? await this.getHistoricalRate(from, to, date)
        : await this.getLatestRate(from, to);

      return toMoney(roundToDecimals(amount * rate, 2));
    },

    async getRateWithTriangulation(
      from: string,
      to: string,
      baseCurrency: string = config.baseCurrency
    ): Promise<number> {
      const fromUpper = from.toUpperCase();
      const toUpper = to.toUpperCase();

      // Same currency = 1
      if (fromUpper === toUpper) {
        return 1;
      }

      // Try direct rate
      try {
        return await this.getLatestRate(from, to);
      } catch (e) {
        if (!(e instanceof CalculationError) || e.code !== "MISSING_FX_RATE") {
          throw e;
        }
      }

      // Try inverse rate
      try {
        const inverseRate = await this.getLatestRate(to, from);
        return 1 / inverseRate;
      } catch (e) {
        if (!(e instanceof CalculationError) || e.code !== "MISSING_FX_RATE") {
          throw e;
        }
      }

      // Triangulate through base currency
      const fromToBase = await this.getLatestRate(from, baseCurrency);
      const baseToTarget = await this.getLatestRate(baseCurrency, to);
      return fromToBase * baseToTarget;
    },

    async getLatestRatesMap(
      fromCurrencies: string[],
      to: string,
      householdId: string
    ): Promise<Map<string, number>> {
      return repository.getLatestRates(fromCurrencies, to, householdId);
    },

    clearCache(): void {
      cache.clear();
      cacheHits = 0;
      cacheMisses = 0;
    },

    getCacheStats(): { size: number; hits: number; misses: number } {
      return {
        size: cache.size,
        hits: cacheHits,
        misses: cacheMisses,
      };
    },
  };
}

// ============================================================================
// Singleton Helper (for backward compatibility during migration)
// ============================================================================

let _globalFxService: FXRateService | null = null;

/**
 * Sets the global FX service instance.
 * Call this at application startup after creating the service.
 *
 * @param service - The FX service instance
 */
export function setGlobalFXService(service: FXRateService): void {
  _globalFxService = service;
}

/**
 * Gets the global FX service instance.
 * Throws if not initialized.
 *
 * @returns The FX service instance
 * @throws Error if service not initialized
 */
export function getGlobalFXService(): FXRateService {
  if (!_globalFxService) {
    throw new Error(
      "FX service not initialized. Call setGlobalFXService() at application startup."
    );
  }
  return _globalFxService;
}

/**
 * Compatibility function matching existing getLatestFxRates signature.
 * Use this during migration to avoid breaking existing code.
 *
 * @deprecated Use fxService.getLatestRatesMap() directly
 */
export async function getLatestFxRates(
  fromCurrencies: string[],
  toCurrency: string,
  householdId: string
): Promise<Map<string, number>> {
  return getGlobalFXService().getLatestRatesMap(fromCurrencies, toCurrency, householdId);
}
