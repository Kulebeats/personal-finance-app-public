/**
 * Tests for Cashflow Calculations
 *
 * @module core/calculations/cashflow/__tests__/cashflow.test
 */

import { describe, it, expect } from "vitest";
import { toMoney, type Money } from "../../types";
import { calculateSavingsRate } from "../savingsRate";
import { calculateNetSavings } from "../netSavings";
import { calculateNetSavingsRate } from "../netSavingsRate";
import { calculateNetWorth, calculateNetWorthBreakdown } from "../netWorth";
import { calculateIncomeAllocation } from "../incomeAllocation";

describe("Cashflow Calculations", () => {
  describe("calculateSavingsRate", () => {
    it("calculates basic savings rate", () => {
      const rate = calculateSavingsRate(toMoney(5000), toMoney(1000));
      expect(rate).toBe(20);
    });

    it("returns 0 when income is 0", () => {
      const rate = calculateSavingsRate(toMoney(0), toMoney(1000));
      expect(rate).toBe(0);
    });

    it("returns 0 when income is negative", () => {
      const rate = calculateSavingsRate(toMoney(-1000), toMoney(500));
      expect(rate).toBe(0);
    });

    it("returns negative when savings are negative", () => {
      const rate = calculateSavingsRate(toMoney(5000), toMoney(-500));
      expect(rate).toBe(-10);
    });

    it("can exceed 100%", () => {
      // E.g., bonus month where contributions from multiple sources
      const rate = calculateSavingsRate(toMoney(1000), toMoney(1500));
      expect(rate).toBe(150);
    });

    it("rounds to 2 decimal places", () => {
      const rate = calculateSavingsRate(toMoney(3000), toMoney(1000));
      expect(rate).toBeCloseTo(33.33, 2);
    });

    it("handles precise calculations", () => {
      const rate = calculateSavingsRate(toMoney(10000), toMoney(2500));
      expect(rate).toBe(25);
    });
  });

  describe("calculateNetSavings", () => {
    it("calculates basic net savings", () => {
      const net = calculateNetSavings(
        toMoney(5000),
        toMoney(3000),
        toMoney(500)
      );
      expect(net).toBe(1500);
    });

    it("handles zero debt payments", () => {
      const net = calculateNetSavings(toMoney(5000), toMoney(3000));
      expect(net).toBe(2000);
    });

    it("can be negative", () => {
      const net = calculateNetSavings(
        toMoney(3000),
        toMoney(4000),
        toMoney(500)
      );
      expect(net).toBe(-1500);
    });

    it("handles zero income", () => {
      const net = calculateNetSavings(toMoney(0), toMoney(1000), toMoney(200));
      expect(net).toBe(-1200);
    });
  });

  describe("calculateNetSavingsRate", () => {
    it("calculates basic net savings rate", () => {
      const rate = calculateNetSavingsRate(
        toMoney(5000),
        toMoney(3500),
        toMoney(500)
      );
      expect(rate).toBe(20);
    });

    it("returns 0 when income is 0", () => {
      const rate = calculateNetSavingsRate(
        toMoney(0),
        toMoney(1000),
        toMoney(200)
      );
      expect(rate).toBe(0);
    });

    it("returns 0 when income is negative", () => {
      const rate = calculateNetSavingsRate(
        toMoney(-1000),
        toMoney(500),
        toMoney(100)
      );
      expect(rate).toBe(0);
    });

    it("can be negative", () => {
      const rate = calculateNetSavingsRate(toMoney(3000), toMoney(4000));
      expect(rate).toBeCloseTo(-33.33, 2);
    });

    it("handles missing debt parameter", () => {
      const rate = calculateNetSavingsRate(toMoney(5000), toMoney(4000));
      expect(rate).toBe(20);
    });

    it("rounds to 2 decimal places", () => {
      const rate = calculateNetSavingsRate(toMoney(3000), toMoney(1000));
      expect(rate).toBeCloseTo(66.67, 2);
    });
  });

  describe("calculateNetWorth", () => {
    it("calculates basic net worth", () => {
      const nw = calculateNetWorth(toMoney(500000), toMoney(200000));
      expect(nw).toBe(300000);
    });

    it("can be negative", () => {
      const nw = calculateNetWorth(toMoney(100000), toMoney(250000));
      expect(nw).toBe(-150000);
    });

    it("handles zero assets", () => {
      const nw = calculateNetWorth(toMoney(0), toMoney(50000));
      expect(nw).toBe(-50000);
    });

    it("handles zero liabilities", () => {
      const nw = calculateNetWorth(toMoney(100000), toMoney(0));
      expect(nw).toBe(100000);
    });

    it("handles both zero", () => {
      const nw = calculateNetWorth(toMoney(0), toMoney(0));
      expect(nw).toBe(0);
    });
  });

  describe("calculateNetWorthBreakdown", () => {
    it("returns complete breakdown", () => {
      const result = calculateNetWorthBreakdown(
        toMoney(500000),
        toMoney(200000),
        "2026-01-08"
      );

      expect(result.netWorth).toBe(300000);
      expect(result.totalAssets).toBe(500000);
      expect(result.totalLiabilities).toBe(200000);
      expect(result.asOfDate).toBe("2026-01-08");
    });

    it("uses current date when not provided", () => {
      const result = calculateNetWorthBreakdown(
        toMoney(100000),
        toMoney(50000)
      );
      expect(result.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("calculateIncomeAllocation", () => {
    it("calculates allocation percentages", () => {
      const result = calculateIncomeAllocation(toMoney(5000), [
        { categoryId: "1", categoryName: "Housing", amount: 1500 },
        { categoryId: "2", categoryName: "Food", amount: 600 },
        { categoryId: "3", categoryName: "Transport", amount: 400 },
      ]);

      expect(result.totalIncome).toBe(5000);
      expect(result.totalExpenses).toBe(2500);
      expect(result.netSavings).toBe(2500);
      expect(result.savingsRate).toBe(50);

      expect(result.categories).toHaveLength(3);
      expect(result.categories[0].percentage).toBe(30); // 1500/5000
      expect(result.categories[1].percentage).toBe(12); // 600/5000
      expect(result.categories[2].percentage).toBe(8); // 400/5000
    });

    it("handles zero income", () => {
      const result = calculateIncomeAllocation(toMoney(0), [
        { categoryId: "1", categoryName: "Housing", amount: 1000 },
      ]);

      expect(result.savingsRate).toBe(0);
      expect(result.categories[0].percentage).toBe(0);
    });

    it("handles empty categories", () => {
      const result = calculateIncomeAllocation(toMoney(5000), []);

      expect(result.totalExpenses).toBe(0);
      expect(result.netSavings).toBe(5000);
      expect(result.savingsRate).toBe(100);
      expect(result.categories).toHaveLength(0);
    });

    it("handles negative net savings", () => {
      const result = calculateIncomeAllocation(toMoney(3000), [
        { categoryId: "1", categoryName: "Housing", amount: 2000 },
        { categoryId: "2", categoryName: "Food", amount: 1500 },
      ]);

      expect(result.netSavings).toBe(-500);
      expect(result.savingsRate).toBeCloseTo(-16.67, 2);
    });
  });
});
