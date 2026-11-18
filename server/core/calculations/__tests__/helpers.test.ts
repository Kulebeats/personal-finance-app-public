/**
 * Tests for Calculation Engine Helpers
 *
 * @module core/calculations/__tests__/helpers.test
 */

import { describe, it, expect } from "vitest";
import {
  toSafeNumber,
  parseNumber,
  roundToDecimals,
  bankersRound,
  floorToDecimals,
  ceilToDecimals,
  preciseMultiply,
  preciseDivide,
  preciseAdd,
  preciseSubtract,
  precisePercentage,
  isApproximatelyEqual,
  clamp,
  sum,
  average,
  min,
  max,
  standardDeviation,
} from "../helpers";
import { CalculationError } from "../errors";

describe("Number Parsing", () => {
  describe("toSafeNumber", () => {
    it("parses valid number strings", () => {
      expect(toSafeNumber("123.45")).toBe(123.45);
      expect(toSafeNumber("100")).toBe(100);
      expect(toSafeNumber("-50")).toBe(-50);
      expect(toSafeNumber("0")).toBe(0);
    });

    it("returns numbers as-is", () => {
      expect(toSafeNumber(123.45)).toBe(123.45);
      expect(toSafeNumber(0)).toBe(0);
      expect(toSafeNumber(-100)).toBe(-100);
    });

    it("handles null and undefined with default fallback", () => {
      expect(toSafeNumber(null)).toBe(0);
      expect(toSafeNumber(undefined)).toBe(0);
    });

    it("handles null and undefined with custom fallback", () => {
      expect(toSafeNumber(null, 50)).toBe(50);
      expect(toSafeNumber(undefined, 100)).toBe(100);
    });

    it("handles NaN with fallback", () => {
      expect(toSafeNumber(NaN)).toBe(0);
      expect(toSafeNumber(NaN, 99)).toBe(99);
    });

    it("handles Infinity with fallback", () => {
      expect(toSafeNumber(Infinity)).toBe(0);
      expect(toSafeNumber(-Infinity)).toBe(0);
    });

    it("handles empty string with fallback", () => {
      expect(toSafeNumber("")).toBe(0);
      expect(toSafeNumber("  ")).toBe(0);
    });

    it("handles invalid strings with fallback", () => {
      expect(toSafeNumber("invalid")).toBe(0);
      expect(toSafeNumber("abc123")).toBe(0);
      expect(toSafeNumber("NaN")).toBe(0);
    });

    it("handles strings with currency symbols", () => {
      expect(toSafeNumber("$100")).toBe(100);
      expect(toSafeNumber("€50.00")).toBe(50);
      expect(toSafeNumber("£1,234.56")).toBe(1234.56);
    });

    it("handles strings with commas", () => {
      expect(toSafeNumber("1,000")).toBe(1000);
      expect(toSafeNumber("1,234,567.89")).toBe(1234567.89);
    });

    it("handles scientific notation", () => {
      expect(toSafeNumber("1e3")).toBe(1000);
      expect(toSafeNumber("1.5e2")).toBe(150);
    });

    it("matches existing parsing patterns", () => {
      // parseFloat(String(value))
      expect(toSafeNumber(String(123))).toBe(123);

      // parseFloat(value ?? "0")
      const nullValue = null;
      expect(toSafeNumber(nullValue)).toBe(0);

      // Number(row.total)
      expect(toSafeNumber({ valueOf: () => 100 })).toBe(100);
    });
  });

  describe("parseNumber", () => {
    it("parses valid values", () => {
      expect(parseNumber("100")).toBe(100);
      expect(parseNumber(50)).toBe(50);
    });

    it("throws on invalid values", () => {
      expect(() => parseNumber("invalid")).toThrow(CalculationError);
      expect(() => parseNumber(NaN)).toThrow(CalculationError);
    });
  });
});

describe("Rounding", () => {
  describe("roundToDecimals", () => {
    it("rounds to 2 decimal places by default", () => {
      expect(roundToDecimals(123.456)).toBe(123.46);
      expect(roundToDecimals(123.454)).toBe(123.45);
      expect(roundToDecimals(123.455)).toBe(123.46); // half-up
    });

    it("rounds to specified decimal places", () => {
      expect(roundToDecimals(123.4567, 3)).toBe(123.457);
      expect(roundToDecimals(123.4567, 1)).toBe(123.5);
      expect(roundToDecimals(123.4567, 0)).toBe(123);
    });

    it("handles whole numbers", () => {
      expect(roundToDecimals(100)).toBe(100);
      expect(roundToDecimals(100, 0)).toBe(100);
    });

    it("handles negative numbers", () => {
      expect(roundToDecimals(-123.456)).toBe(-123.46);
    });

    it("matches existing Math.round(x * 100) / 100 behavior", () => {
      const testValues = [123.456, 0.005, 99.994, 99.995, -50.555];
      for (const val of testValues) {
        const expected = Math.round(val * 100) / 100;
        expect(roundToDecimals(val, 2)).toBe(expected);
      }
    });

    it("returns NaN for NaN input", () => {
      expect(roundToDecimals(NaN)).toBeNaN();
    });

    it("returns Infinity for Infinity input", () => {
      expect(roundToDecimals(Infinity)).toBe(Infinity);
    });
  });

  describe("bankersRound", () => {
    it("rounds half to even (bankers rounding)", () => {
      expect(bankersRound(2.5, 0)).toBe(2); // rounds to even
      expect(bankersRound(3.5, 0)).toBe(4); // rounds to even
      expect(bankersRound(2.25, 1)).toBe(2.2); // rounds to even
      expect(bankersRound(2.35, 1)).toBe(2.4); // rounds to even
    });
  });

  describe("floorToDecimals", () => {
    it("floors to specified decimal places", () => {
      expect(floorToDecimals(123.456)).toBe(123.45);
      expect(floorToDecimals(123.459)).toBe(123.45);
      expect(floorToDecimals(-123.451)).toBe(-123.46);
    });
  });

  describe("ceilToDecimals", () => {
    it("ceils to specified decimal places", () => {
      expect(ceilToDecimals(123.451)).toBe(123.46);
      expect(ceilToDecimals(123.45)).toBe(123.45);
      expect(ceilToDecimals(-123.456)).toBe(-123.45);
    });
  });
});

describe("Precision Arithmetic", () => {
  describe("preciseMultiply", () => {
    it("multiplies with precision", () => {
      // Famous floating point issue: 0.1 * 0.2 !== 0.02 in JS
      const jsResult = 0.1 * 0.2;
      expect(jsResult).not.toBe(0.02);

      // Our precise version should work
      expect(preciseMultiply(0.1, 0.2)).toBe(0.02);
    });

    it("handles large numbers", () => {
      expect(preciseMultiply(1000000, 1000000)).toBe(1000000000000);
    });

    it("handles negative numbers", () => {
      expect(preciseMultiply(-5, 3)).toBe(-15);
      expect(preciseMultiply(-5, -3)).toBe(15);
    });
  });

  describe("preciseDivide", () => {
    it("divides with precision", () => {
      expect(preciseDivide(1, 3)).toBeCloseTo(0.3333333333333333, 10);
      expect(preciseDivide(10, 4)).toBe(2.5);
    });

    it("throws on division by zero", () => {
      expect(() => preciseDivide(10, 0)).toThrow(CalculationError);
      try {
        preciseDivide(10, 0);
      } catch (e) {
        expect((e as CalculationError).code).toBe("DIVISION_BY_ZERO");
      }
    });
  });

  describe("preciseAdd", () => {
    it("adds with precision", () => {
      // Famous floating point issue: 0.1 + 0.2 !== 0.3 in JS
      const jsResult = 0.1 + 0.2;
      expect(jsResult).not.toBe(0.3);

      // Our precise version should work
      expect(preciseAdd(0.1, 0.2)).toBe(0.3);
    });

    it("handles multiple numbers", () => {
      expect(preciseAdd(1, 2, 3, 4, 5)).toBe(15);
    });

    it("returns 0 for empty array", () => {
      expect(preciseAdd()).toBe(0);
    });
  });

  describe("preciseSubtract", () => {
    it("subtracts with precision", () => {
      expect(preciseSubtract(0.3, 0.1)).toBe(0.2);
      expect(preciseSubtract(100, 30)).toBe(70);
    });
  });

  describe("precisePercentage", () => {
    it("calculates percentage of value", () => {
      expect(precisePercentage(1000, 15)).toBe(150);
      expect(precisePercentage(1000, 0.5)).toBe(5);
      expect(precisePercentage(200, 50)).toBe(100);
    });
  });
});

describe("Comparison Utilities", () => {
  describe("isApproximatelyEqual", () => {
    it("returns true for equal numbers", () => {
      expect(isApproximatelyEqual(1, 1)).toBe(true);
      expect(isApproximatelyEqual(0, 0)).toBe(true);
    });

    it("returns true for numbers within tolerance", () => {
      expect(isApproximatelyEqual(1.0001, 1.0002, 0.001)).toBe(true);
      expect(isApproximatelyEqual(100, 100.0005, 0.001)).toBe(true);
    });

    it("returns false for numbers outside tolerance", () => {
      expect(isApproximatelyEqual(1, 2, 0.001)).toBe(false);
      expect(isApproximatelyEqual(100, 101, 0.5)).toBe(false);
    });
  });

  describe("clamp", () => {
    it("clamps value within range", () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it("handles edge cases", () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });
  });
});

describe("Aggregation Helpers", () => {
  describe("sum", () => {
    it("sums array of numbers", () => {
      expect(sum([1, 2, 3, 4, 5])).toBe(15);
      expect(sum([100, -50, 25])).toBe(75);
    });

    it("returns 0 for empty array", () => {
      expect(sum([])).toBe(0);
    });
  });

  describe("average", () => {
    it("calculates average", () => {
      expect(average([1, 2, 3, 4, 5])).toBe(3);
      expect(average([10, 20])).toBe(15);
    });

    it("returns 0 for empty array", () => {
      expect(average([])).toBe(0);
    });
  });

  describe("min", () => {
    it("finds minimum", () => {
      expect(min([5, 1, 9, 3])).toBe(1);
      expect(min([-10, 5, 0])).toBe(-10);
    });

    it("returns Infinity for empty array", () => {
      expect(min([])).toBe(Infinity);
    });
  });

  describe("max", () => {
    it("finds maximum", () => {
      expect(max([5, 1, 9, 3])).toBe(9);
      expect(max([-10, -5, -1])).toBe(-1);
    });

    it("returns -Infinity for empty array", () => {
      expect(max([])).toBe(-Infinity);
    });
  });

  describe("standardDeviation", () => {
    it("calculates standard deviation", () => {
      const values = [2, 4, 4, 4, 5, 5, 7, 9];
      const result = standardDeviation(values);
      expect(result).toBeCloseTo(2, 0);
    });

    it("returns 0 for empty array", () => {
      expect(standardDeviation([])).toBe(0);
    });

    it("returns 0 for single value", () => {
      expect(standardDeviation([5])).toBe(0);
    });
  });
});

describe("Edge Cases - Null/Undefined/NaN Handling", () => {
  describe("toSafeNumber with null/undefined", () => {
    it("should handle various nullish values", () => {
      expect(toSafeNumber(null)).toBe(0);
      expect(toSafeNumber(undefined)).toBe(0);
      expect(toSafeNumber(NaN)).toBe(0);
      expect(toSafeNumber(Infinity)).toBe(0);
      expect(toSafeNumber(-Infinity)).toBe(0);
    });

    it("should use custom fallback for null", () => {
      expect(toSafeNumber(null, 999)).toBe(999);
      expect(toSafeNumber(undefined, -1)).toBe(-1);
    });
  });

  describe("preciseAdd with nullish values", () => {
    it("should treat undefined as zero in arrays", () => {
      expect(preciseAdd(1, 2, 3)).toBe(6);
    });

    it("should handle empty array", () => {
      expect(preciseAdd()).toBe(0);
    });
  });

  describe("preciseDivide by zero", () => {
    it("should throw on division by zero", () => {
      expect(() => preciseDivide(10, 0)).toThrow(CalculationError);
    });

    it("should throw with proper error code", () => {
      try {
        preciseDivide(10, 0);
        expect(true).toBe(false); // Should not reach here
      } catch (e) {
        expect((e as CalculationError).code).toBe("DIVISION_BY_ZERO");
      }
    });
  });

  describe("Aggregation with empty arrays", () => {
    it("should handle empty array in sum", () => {
      expect(sum([])).toBe(0);
    });

    it("should handle empty array in average", () => {
      expect(average([])).toBe(0);
    });

    it("should handle empty array in min", () => {
      expect(min([])).toBe(Infinity);
    });

    it("should handle empty array in max", () => {
      expect(max([])).toBe(-Infinity);
    });

    it("should handle empty array in standardDeviation", () => {
      expect(standardDeviation([])).toBe(0);
    });
  });

  describe("Single element arrays", () => {
    it("should handle single value in sum", () => {
      expect(sum([42])).toBe(42);
    });

    it("should handle single value in average", () => {
      expect(average([42])).toBe(42);
    });

    it("should handle single value in min", () => {
      expect(min([42])).toBe(42);
    });

    it("should handle single value in max", () => {
      expect(max([42])).toBe(42);
    });

    it("should handle single value in standardDeviation", () => {
      expect(standardDeviation([42])).toBe(0);
    });
  });
});

describe("Edge Cases - Negative Number Handling", () => {
  describe("roundToDecimals with negatives", () => {
    it("should round negative numbers correctly", () => {
      expect(roundToDecimals(-123.456)).toBe(-123.46);
      expect(roundToDecimals(-123.454)).toBe(-123.45);
    });

    it("should handle negative zero", () => {
      expect(roundToDecimals(-0.004)).toBe(-0.00);
    });
  });

  describe("floorToDecimals with negatives", () => {
    it("should floor negative numbers towards negative infinity", () => {
      expect(floorToDecimals(-123.451)).toBe(-123.46);
      expect(floorToDecimals(-123.459)).toBe(-123.46);
    });
  });

  describe("ceilToDecimals with negatives", () => {
    it("should ceil negative numbers towards positive infinity", () => {
      expect(ceilToDecimals(-123.456)).toBe(-123.45);
      expect(ceilToDecimals(-123.45)).toBe(-123.45);
    });
  });

  describe("preciseMultiply with negatives", () => {
    it("should handle negative * positive", () => {
      expect(preciseMultiply(-5, 3)).toBe(-15);
    });

    it("should handle positive * negative", () => {
      expect(preciseMultiply(5, -3)).toBe(-15);
    });

    it("should handle negative * negative", () => {
      expect(preciseMultiply(-5, -3)).toBe(15);
    });
  });

  describe("preciseDivide with negatives", () => {
    it("should handle negative / positive", () => {
      expect(preciseDivide(-10, 2)).toBe(-5);
    });

    it("should handle positive / negative", () => {
      expect(preciseDivide(10, -2)).toBe(-5);
    });

    it("should handle negative / negative", () => {
      expect(preciseDivide(-10, -2)).toBe(5);
    });
  });

  describe("preciseSubtract resulting in negative", () => {
    it("should handle subtraction resulting in negative", () => {
      expect(preciseSubtract(50, 100)).toBe(-50);
      expect(preciseSubtract(0.1, 0.3)).toBe(-0.2);
    });
  });

  describe("Aggregation with negative numbers", () => {
    it("should sum with negative numbers", () => {
      expect(sum([100, -50, 25, -10])).toBe(65);
    });

    it("should average with negative numbers", () => {
      expect(average([10, -10, 20, -20])).toBe(0);
    });

    it("should find min with all negatives", () => {
      expect(min([-10, -5, -1])).toBe(-10);
    });

    it("should find max with all negatives", () => {
      expect(max([-10, -5, -1])).toBe(-1);
    });
  });
});

describe("Edge Cases - Very Large Numbers", () => {
  describe("preciseMultiply with large numbers", () => {
    it("should handle very large multiplication", () => {
      expect(preciseMultiply(1000000, 1000000)).toBe(1000000000000);
    });

    it("should handle large * decimal", () => {
      expect(preciseMultiply(1000000, 0.5)).toBe(500000);
    });
  });

  describe("preciseDivide with large numbers", () => {
    it("should handle very large division", () => {
      expect(preciseDivide(1000000000000, 1000000)).toBe(1000000);
    });
  });

  describe("preciseAdd with large numbers", () => {
    it("should handle adding very large numbers", () => {
      expect(preciseAdd(999999999999, 1)).toBe(1000000000000);
    });

    it("should handle array of large numbers", () => {
      expect(preciseAdd(1000000, 2000000, 3000000)).toBe(6000000);
    });
  });

  describe("Aggregation with large numbers", () => {
    it("should sum large numbers", () => {
      const result = sum([1000000, 2000000, 3000000]);
      expect(result).toBe(6000000);
    });

    it("should average large numbers", () => {
      const result = average([1000000, 2000000, 3000000]);
      expect(result).toBe(2000000);
    });
  });

  describe("Rounding with large numbers", () => {
    it("should round large numbers", () => {
      expect(roundToDecimals(999999999.456, 2)).toBe(999999999.46);
    });

    it("should handle max safe integer", () => {
      const large = Number.MAX_SAFE_INTEGER - 0.5;
      expect(typeof roundToDecimals(large, 0)).toBe("number");
    });
  });
});

describe("Edge Cases - Boundary Conditions", () => {
  describe("Rounding at 0.5 boundary", () => {
    it("should round 0.5 up (half-up rounding)", () => {
      expect(roundToDecimals(0.5, 0)).toBe(1);
      expect(roundToDecimals(1.5, 0)).toBe(2);
      expect(roundToDecimals(2.5, 0)).toBe(3);
    });

    it("should handle 0.005 boundary for 2 decimals", () => {
      expect(roundToDecimals(0.005, 2)).toBe(0.01);
      expect(roundToDecimals(0.004, 2)).toBe(0.00);
    });
  });

  describe("Bankers rounding at 0.5 boundary", () => {
    it("should round 0.5 to nearest even", () => {
      expect(bankersRound(0.5, 0)).toBe(0); // Round to even
      expect(bankersRound(1.5, 0)).toBe(2); // Round to even
      expect(bankersRound(2.5, 0)).toBe(2); // Round to even
      expect(bankersRound(3.5, 0)).toBe(4); // Round to even
    });

    it("should handle decimal boundary with bankers round", () => {
      expect(bankersRound(2.25, 1)).toBe(2.2); // Round to even
      expect(bankersRound(2.35, 1)).toBe(2.4); // Round to even
    });
  });

  describe("clamp at boundaries", () => {
    it("should clamp at lower boundary", () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(-1, 0, 10)).toBe(0);
    });

    it("should clamp at upper boundary", () => {
      expect(clamp(10, 0, 10)).toBe(10);
      expect(clamp(11, 0, 10)).toBe(10);
    });

    it("should handle negative ranges", () => {
      expect(clamp(-5, -10, -1)).toBe(-5);
      expect(clamp(-15, -10, -1)).toBe(-10);
      expect(clamp(0, -10, -1)).toBe(-1);
    });

    it("should handle single point range", () => {
      expect(clamp(5, 10, 10)).toBe(10);
      expect(clamp(15, 10, 10)).toBe(10);
    });
  });

  describe("isApproximatelyEqual at tolerance boundary", () => {
    it("should handle exact tolerance boundary", () => {
      expect(isApproximatelyEqual(1, 1.001, 0.001)).toBe(true);
      expect(isApproximatelyEqual(1, 1.002, 0.001)).toBe(false);
    });

    it("should handle zero tolerance", () => {
      expect(isApproximatelyEqual(1, 1, 0)).toBe(true);
      expect(isApproximatelyEqual(1, 1.0000001, 0)).toBe(false);
    });

    it("should handle negative numbers", () => {
      expect(isApproximatelyEqual(-1, -1.0005, 0.001)).toBe(true);
      expect(isApproximatelyEqual(-1, -1.002, 0.001)).toBe(false);
    });
  });
});

describe("Edge Cases - Zero Values in Calculations", () => {
  describe("preciseMultiply with zero", () => {
    it("should multiply by zero", () => {
      expect(preciseMultiply(100, 0)).toBe(0);
      expect(preciseMultiply(0, 100)).toBe(0);
      expect(preciseMultiply(0, 0)).toBe(0);
    });
  });

  describe("preciseAdd with zeros", () => {
    it("should add zeros", () => {
      expect(preciseAdd(0, 0, 0)).toBe(0);
      expect(preciseAdd(100, 0, -100)).toBe(0);
    });
  });

  describe("preciseSubtract to zero", () => {
    it("should subtract to zero", () => {
      expect(preciseSubtract(100, 100)).toBe(0);
      expect(preciseSubtract(0.3, 0.3)).toBe(0);
    });

    it("should subtract from zero", () => {
      expect(preciseSubtract(0, 50)).toBe(-50);
    });
  });

  describe("precisePercentage with zero", () => {
    it("should handle zero value", () => {
      expect(precisePercentage(0, 50)).toBe(0);
    });

    it("should handle zero percentage", () => {
      expect(precisePercentage(1000, 0)).toBe(0);
    });

    it("should handle both zero", () => {
      expect(precisePercentage(0, 0)).toBe(0);
    });
  });
});

describe("Edge Cases - Special Number Values", () => {
  describe("roundToDecimals with special values", () => {
    it("should return NaN for NaN input", () => {
      expect(roundToDecimals(NaN)).toBeNaN();
    });

    it("should return Infinity for Infinity input", () => {
      expect(roundToDecimals(Infinity)).toBe(Infinity);
      expect(roundToDecimals(-Infinity)).toBe(-Infinity);
    });
  });

  describe("toSafeNumber with scientific notation", () => {
    it("should parse scientific notation", () => {
      expect(toSafeNumber("1e3")).toBe(1000);
      expect(toSafeNumber("1.5e2")).toBe(150);
      expect(toSafeNumber("1e-3")).toBe(0.001);
    });
  });
});

describe("Edge Cases - Precision at Decimal Places", () => {
  describe("roundToDecimals with various decimal places", () => {
    it("should round to 0 decimal places", () => {
      expect(roundToDecimals(123.456, 0)).toBe(123);
      expect(roundToDecimals(123.567, 0)).toBe(124);
    });

    it("should round to 1 decimal place", () => {
      expect(roundToDecimals(123.456, 1)).toBe(123.5);
      expect(roundToDecimals(123.45, 1)).toBe(123.5);
    });

    it("should round to 3 decimal places", () => {
      expect(roundToDecimals(123.4567, 3)).toBe(123.457);
    });

    it("should round to 4 decimal places", () => {
      expect(roundToDecimals(123.456789, 4)).toBe(123.4568);
    });
  });

  describe("floorToDecimals with various decimal places", () => {
    it("should floor to 0 decimals", () => {
      expect(floorToDecimals(123.999, 0)).toBe(123);
    });

    it("should floor to 1 decimal", () => {
      expect(floorToDecimals(123.999, 1)).toBe(123.9);
    });
  });

  describe("ceilToDecimals with various decimal places", () => {
    it("should ceil to 0 decimals", () => {
      expect(ceilToDecimals(123.001, 0)).toBe(124);
    });

    it("should ceil to 1 decimal", () => {
      expect(ceilToDecimals(123.001, 1)).toBe(123.1);
    });
  });
});
