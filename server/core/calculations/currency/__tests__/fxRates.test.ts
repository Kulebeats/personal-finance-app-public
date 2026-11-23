/**
 * Tests for FX Rate Service
 *
 * @module core/calculations/currency/__tests__/fxRates.test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createFXRateService,
  type FXRateRepository,
  type FXRateService,
  type FXServiceConfig,
  DEFAULT_FX_CONFIG,
} from "../fxRates";
import { CalculationError } from "../../errors";
import { toMoney } from "../../types";

// Mock repository
function createMockRepository(): FXRateRepository {
  return {
    getLatestRate: vi.fn(),
    getRateForDate: vi.fn(),
    getMostRecentRateBefore: vi.fn(),
    getLatestRates: vi.fn(),
  };
}

describe("FXRateService", () => {
  let mockRepo: ReturnType<typeof createMockRepository>;
  let fxService: FXRateService;

  beforeEach(() => {
    mockRepo = createMockRepository();
    fxService = createFXRateService(mockRepo, DEFAULT_FX_CONFIG);
  });

  describe("getLatestRate", () => {
    it("returns 1 for same currency conversion", async () => {
      const rate = await fxService.getLatestRate("USD", "USD");
      expect(rate).toBe(1);
      expect(mockRepo.getLatestRate).not.toHaveBeenCalled();
    });

    it("returns 1 for case-insensitive same currency", async () => {
      const rate = await fxService.getLatestRate("usd", "USD");
      expect(rate).toBe(1);
    });

    it("fetches rate from repository", async () => {
      mockRepo.getLatestRate = vi.fn().mockResolvedValue({
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: 25.43,
        date: "2026-01-08",
        source: "boz",
      });

      const rate = await fxService.getLatestRate("USD", "ZMW");
      expect(rate).toBe(25.43);
      expect(mockRepo.getLatestRate).toHaveBeenCalledWith("USD", "ZMW");
    });

    it("caches result and returns cached value", async () => {
      mockRepo.getLatestRate = vi.fn().mockResolvedValue({
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: 25.43,
        date: "2026-01-08",
        source: "boz",
      });

      // First call - cache miss
      const rate1 = await fxService.getLatestRate("USD", "ZMW");
      expect(rate1).toBe(25.43);
      expect(mockRepo.getLatestRate).toHaveBeenCalledTimes(1);

      // Second call - cache hit
      const rate2 = await fxService.getLatestRate("USD", "ZMW");
      expect(rate2).toBe(25.43);
      expect(mockRepo.getLatestRate).toHaveBeenCalledTimes(1); // Still 1
    });

    it("throws MISSING_FX_RATE when rate not found", async () => {
      mockRepo.getLatestRate = vi.fn().mockResolvedValue(null);

      await expect(fxService.getLatestRate("XYZ", "ZMW")).rejects.toThrow(
        CalculationError
      );

      try {
        await fxService.getLatestRate("XYZ", "ZMW");
      } catch (e) {
        expect((e as CalculationError).code).toBe("MISSING_FX_RATE");
        expect((e as CalculationError).context.from).toBe("XYZ");
        expect((e as CalculationError).context.to).toBe("ZMW");
      }
    });
  });

  describe("getHistoricalRate", () => {
    it("returns 1 for same currency", async () => {
      const rate = await fxService.getHistoricalRate(
        "ZMW",
        "ZMW",
        "2026-01-01"
      );
      expect(rate).toBe(1);
    });

    it("fetches rate for exact date", async () => {
      mockRepo.getRateForDate = vi.fn().mockResolvedValue({
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: 24.5,
        date: "2026-01-01",
        source: "boz",
      });

      const rate = await fxService.getHistoricalRate(
        "USD",
        "ZMW",
        "2026-01-01"
      );
      expect(rate).toBe(24.5);
    });

    it("falls back to most recent rate before date", async () => {
      mockRepo.getRateForDate = vi.fn().mockResolvedValue(null);
      mockRepo.getMostRecentRateBefore = vi.fn().mockResolvedValue({
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: 24.0,
        date: "2025-12-31",
        source: "boz",
      });

      const rate = await fxService.getHistoricalRate(
        "USD",
        "ZMW",
        "2026-01-01"
      );
      expect(rate).toBe(24.0);
    });

    it("throws MISSING_FX_RATE when no rate found", async () => {
      mockRepo.getRateForDate = vi.fn().mockResolvedValue(null);
      mockRepo.getMostRecentRateBefore = vi.fn().mockResolvedValue(null);

      await expect(
        fxService.getHistoricalRate("USD", "ZMW", "2020-01-01")
      ).rejects.toThrow(CalculationError);
    });
  });

  describe("convert", () => {
    it("returns same amount for same currency", async () => {
      const result = await fxService.convert(toMoney(100), "ZMW", "ZMW");
      expect(result).toBe(100);
    });

    it("converts using latest rate", async () => {
      mockRepo.getLatestRate = vi.fn().mockResolvedValue({
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: 25,
        date: "2026-01-08",
        source: "boz",
      });

      const result = await fxService.convert(toMoney(100), "USD", "ZMW");
      expect(result).toBe(2500);
    });

    it("converts using historical rate when date provided", async () => {
      mockRepo.getRateForDate = vi.fn().mockResolvedValue({
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: 24,
        date: "2026-01-01",
        source: "boz",
      });

      const result = await fxService.convert(
        toMoney(100),
        "USD",
        "ZMW",
        "2026-01-01"
      );
      expect(result).toBe(2400);
    });

    it("rounds to 2 decimal places", async () => {
      mockRepo.getLatestRate = vi.fn().mockResolvedValue({
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: 25.4321,
        date: "2026-01-08",
        source: "boz",
      });

      const result = await fxService.convert(toMoney(100.99), "USD", "ZMW");
      expect(result).toBeCloseTo(2568.39, 2); // 100.99 * 25.4321 rounded to 2 decimals
    });
  });

  describe("getRateWithTriangulation", () => {
    it("returns 1 for same currency", async () => {
      const rate = await fxService.getRateWithTriangulation("USD", "USD");
      expect(rate).toBe(1);
    });

    it("uses direct rate when available", async () => {
      mockRepo.getLatestRate = vi.fn().mockResolvedValue({
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: 25,
        date: "2026-01-08",
        source: "boz",
      });

      const rate = await fxService.getRateWithTriangulation("USD", "ZMW");
      expect(rate).toBe(25);
    });

    it("uses inverse rate when direct not available", async () => {
      // First call (direct) returns null
      mockRepo.getLatestRate = vi
        .fn()
        .mockResolvedValueOnce(null) // USD -> ZMW not found
        .mockResolvedValueOnce({
          // ZMW -> USD found
          fromCurrency: "ZMW",
          toCurrency: "USD",
          rate: 0.04,
          date: "2026-01-08",
          source: "boz",
        });

      // Need a fresh service since cache might interfere
      const freshService = createFXRateService(mockRepo, DEFAULT_FX_CONFIG);
      const rate = await freshService.getRateWithTriangulation("USD", "ZMW");
      expect(rate).toBe(25); // 1 / 0.04
    });

    it("triangulates through base currency when neither direct nor inverse available", async () => {
      // This test simulates EUR -> ZMW conversion when only EUR -> USD and USD -> ZMW exist
      const callCount = { value: 0 };
      mockRepo.getLatestRate = vi.fn().mockImplementation(async (from, to) => {
        callCount.value++;
        // 1st call: EUR -> ZMW (direct) - not found
        // 2nd call: ZMW -> EUR (inverse) - not found
        // 3rd call: EUR -> USD (triangulation step 1) - found
        // 4th call: USD -> ZMW (triangulation step 2) - found

        if (from === "EUR" && to === "USD") {
          return {
            fromCurrency: "EUR",
            toCurrency: "USD",
            rate: 1.1,
            date: "2026-01-08",
            source: "test",
          };
        }
        if (from === "USD" && to === "ZMW") {
          return {
            fromCurrency: "USD",
            toCurrency: "ZMW",
            rate: 25,
            date: "2026-01-08",
            source: "test",
          };
        }
        return null;
      });

      const freshService = createFXRateService(mockRepo, DEFAULT_FX_CONFIG);
      const rate = await freshService.getRateWithTriangulation(
        "EUR",
        "ZMW",
        "USD"
      );
      expect(rate).toBeCloseTo(27.5, 5); // 1.1 * 25
    });
  });

  describe("getLatestRatesMap", () => {
    it("returns rates from repository", async () => {
      const mockMap = new Map([
        ["USD", 25],
        ["EUR", 27],
      ]);
      mockRepo.getLatestRates = vi.fn().mockResolvedValue(mockMap);

      const result = await fxService.getLatestRatesMap(["USD", "EUR"], "ZMW", "household-1");
      expect(result.get("USD")).toBe(25);
      expect(result.get("EUR")).toBe(27);
    });
  });

  describe("cache management", () => {
    it("clearCache resets the cache", async () => {
      mockRepo.getLatestRate = vi.fn().mockResolvedValue({
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: 25,
        date: "2026-01-08",
        source: "boz",
      });

      // Populate cache
      await fxService.getLatestRate("USD", "ZMW");
      expect(mockRepo.getLatestRate).toHaveBeenCalledTimes(1);

      // Clear cache
      fxService.clearCache();

      // Should fetch again
      await fxService.getLatestRate("USD", "ZMW");
      expect(mockRepo.getLatestRate).toHaveBeenCalledTimes(2);
    });

    it("getCacheStats returns statistics", async () => {
      mockRepo.getLatestRate = vi.fn().mockResolvedValue({
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: 25,
        date: "2026-01-08",
        source: "boz",
      });

      // Initial state
      let stats = fxService.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);

      // First call - miss
      await fxService.getLatestRate("USD", "ZMW");
      stats = fxService.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);

      // Second call - hit
      await fxService.getLatestRate("USD", "ZMW");
      stats = fxService.getCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });

  describe("configuration", () => {
    it("respects custom cache TTL", async () => {
      const config: FXServiceConfig = {
        ...DEFAULT_FX_CONFIG,
        cacheTtlSeconds: 0.001, // Very short TTL
      };

      const service = createFXRateService(mockRepo, config);

      mockRepo.getLatestRate = vi.fn().mockResolvedValue({
        fromCurrency: "USD",
        toCurrency: "ZMW",
        rate: 25,
        date: "2026-01-08",
        source: "boz",
      });

      await service.getLatestRate("USD", "ZMW");
      expect(mockRepo.getLatestRate).toHaveBeenCalledTimes(1);

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      await service.getLatestRate("USD", "ZMW");
      expect(mockRepo.getLatestRate).toHaveBeenCalledTimes(2);
    });

    it("respects custom base currency for triangulation", async () => {
      const config: FXServiceConfig = {
        ...DEFAULT_FX_CONFIG,
        baseCurrency: "EUR",
      };

      const service = createFXRateService(mockRepo, config);

      mockRepo.getLatestRate = vi.fn().mockImplementation(async (from, to) => {
        if (from === "GBP" && to === "EUR") {
          return {
            fromCurrency: "GBP",
            toCurrency: "EUR",
            rate: 1.15,
            date: "2026-01-08",
            source: "test",
          };
        }
        if (from === "EUR" && to === "ZMW") {
          return {
            fromCurrency: "EUR",
            toCurrency: "ZMW",
            rate: 28,
            date: "2026-01-08",
            source: "test",
          };
        }
        return null;
      });

      const rate = await service.getRateWithTriangulation("GBP", "ZMW");
      expect(rate).toBeCloseTo(32.2, 5); // 1.15 * 28
    });
  });
});
