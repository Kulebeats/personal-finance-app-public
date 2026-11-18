/**
 * Tests for Calculation Engine Types
 *
 * @module core/calculations/__tests__/types.test
 */

import { describe, it, expect } from "vitest";
import {
  toMoney,
  toPercentage,
  toRatio,
  toMoneySafe,
  toPercentageSafe,
  toRatioSafe,
  isMoney,
  isPercentage,
  isRatio,
  type Money,
  type Percentage,
  type Ratio,
} from "../types";
import { CalculationError } from "../errors";

describe("Branded Types", () => {
  describe("toMoney", () => {
    it("creates Money from valid positive number", () => {
      const result = toMoney(100.5);
      expect(result).toBe(100.5);
    });

    it("creates Money from zero", () => {
      const result = toMoney(0);
      expect(result).toBe(0);
    });

    it("creates Money from negative number", () => {
      const result = toMoney(-500);
      expect(result).toBe(-500);
    });

    it("creates Money from large number", () => {
      const result = toMoney(1_000_000_000);
      expect(result).toBe(1_000_000_000);
    });

    it("creates Money from small decimal", () => {
      const result = toMoney(0.01);
      expect(result).toBe(0.01);
    });

    it("throws on NaN", () => {
      expect(() => toMoney(NaN)).toThrow(CalculationError);
      try {
        toMoney(NaN);
      } catch (e) {
        expect((e as CalculationError).code).toBe("INVALID_MONEY");
      }
    });

    it("throws on Infinity", () => {
      expect(() => toMoney(Infinity)).toThrow(CalculationError);
    });

    it("throws on negative Infinity", () => {
      expect(() => toMoney(-Infinity)).toThrow(CalculationError);
    });
  });

  describe("toPercentage", () => {
    it("creates Percentage from valid number", () => {
      const result = toPercentage(25.5);
      expect(result).toBe(25.5);
    });

    it("creates Percentage from zero", () => {
      const result = toPercentage(0);
      expect(result).toBe(0);
    });

    it("creates Percentage from 100", () => {
      const result = toPercentage(100);
      expect(result).toBe(100);
    });

    it("allows percentage over 100", () => {
      const result = toPercentage(150);
      expect(result).toBe(150);
    });

    it("allows negative percentage", () => {
      const result = toPercentage(-10);
      expect(result).toBe(-10);
    });

    it("throws on NaN", () => {
      expect(() => toPercentage(NaN)).toThrow(CalculationError);
      try {
        toPercentage(NaN);
      } catch (e) {
        expect((e as CalculationError).code).toBe("INVALID_PERCENTAGE");
      }
    });

    it("throws on Infinity", () => {
      expect(() => toPercentage(Infinity)).toThrow(CalculationError);
    });
  });

  describe("toRatio", () => {
    it("creates Ratio from valid number", () => {
      const result = toRatio(0.36);
      expect(result).toBe(0.36);
    });

    it("creates Ratio from zero", () => {
      const result = toRatio(0);
      expect(result).toBe(0);
    });

    it("creates Ratio from 1", () => {
      const result = toRatio(1);
      expect(result).toBe(1);
    });

    it("allows ratio greater than 1", () => {
      const result = toRatio(2.5);
      expect(result).toBe(2.5);
    });

    it("throws on NaN", () => {
      expect(() => toRatio(NaN)).toThrow(CalculationError);
      try {
        toRatio(NaN);
      } catch (e) {
        expect((e as CalculationError).code).toBe("INVALID_RATIO");
      }
    });

    it("throws on Infinity", () => {
      expect(() => toRatio(Infinity)).toThrow(CalculationError);
    });
  });

  describe("Safe constructors", () => {
    describe("toMoneySafe", () => {
      it("returns value for valid number", () => {
        expect(toMoneySafe(100)).toBe(100);
      });

      it("returns default fallback for NaN", () => {
        expect(toMoneySafe(NaN)).toBe(0);
      });

      it("returns custom fallback for NaN", () => {
        expect(toMoneySafe(NaN, 50)).toBe(50);
      });

      it("returns fallback for Infinity", () => {
        expect(toMoneySafe(Infinity, 100)).toBe(100);
      });
    });

    describe("toPercentageSafe", () => {
      it("returns value for valid number", () => {
        expect(toPercentageSafe(50)).toBe(50);
      });

      it("returns fallback for NaN", () => {
        expect(toPercentageSafe(NaN)).toBe(0);
      });
    });

    describe("toRatioSafe", () => {
      it("returns value for valid number", () => {
        expect(toRatioSafe(0.5)).toBe(0.5);
      });

      it("returns fallback for NaN", () => {
        expect(toRatioSafe(NaN, 1)).toBe(1);
      });
    });
  });

  describe("Type guards", () => {
    describe("isMoney", () => {
      it("returns true for finite numbers", () => {
        expect(isMoney(100)).toBe(true);
        expect(isMoney(0)).toBe(true);
        expect(isMoney(-50)).toBe(true);
        expect(isMoney(0.01)).toBe(true);
      });

      it("returns false for non-numbers", () => {
        expect(isMoney("100")).toBe(false);
        expect(isMoney(null)).toBe(false);
        expect(isMoney(undefined)).toBe(false);
        expect(isMoney({})).toBe(false);
      });

      it("returns false for NaN and Infinity", () => {
        expect(isMoney(NaN)).toBe(false);
        expect(isMoney(Infinity)).toBe(false);
      });
    });

    describe("isPercentage", () => {
      it("returns true for finite numbers", () => {
        expect(isPercentage(50)).toBe(true);
        expect(isPercentage(0)).toBe(true);
        expect(isPercentage(100)).toBe(true);
      });

      it("returns false for non-numbers", () => {
        expect(isPercentage("50%")).toBe(false);
      });
    });

    describe("isRatio", () => {
      it("returns true for finite numbers", () => {
        expect(isRatio(0.5)).toBe(true);
        expect(isRatio(1)).toBe(true);
      });

      it("returns false for non-numbers", () => {
        expect(isRatio("0.5")).toBe(false);
      });
    });
  });

  describe("Type safety (compile-time)", () => {
    it("Money, Percentage, and Ratio are distinct types", () => {
      // These are runtime tests that verify the values work correctly
      // Type safety is enforced at compile time
      const money: Money = toMoney(100);
      const percentage: Percentage = toPercentage(50);
      const ratio: Ratio = toRatio(0.5);

      // Verify they're all numbers at runtime
      expect(typeof money).toBe("number");
      expect(typeof percentage).toBe("number");
      expect(typeof ratio).toBe("number");
    });
  });
});
