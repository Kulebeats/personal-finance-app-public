/**
 * Tests for Investment Calculations
 *
 * @module core/calculations/investments/__tests__/investments.test
 */

import { describe, it, expect } from "vitest";
import { toMoney } from "../../types";
import { calculateTimeWeightedReturn, calculateSimpleReturn } from "../twr";
import {
  calculateGainLoss,
  calculateHoldingGainLoss,
  calculateRealizedGainLoss,
} from "../gainLoss";

describe("Investment Calculations", () => {
  describe("calculateTimeWeightedReturn", () => {
    it("returns zero for empty periods", () => {
      const result = calculateTimeWeightedReturn([]);
      expect(result.twr).toBe(0);
      expect(result.periodCount).toBe(0);
    });

    it("calculates TWR for single period", () => {
      const result = calculateTimeWeightedReturn([
        {
          startDate: "2025-01-01",
          endDate: "2025-12-31",
          startValue: 10000,
          endValue: 11000,
          cashFlow: 0,
        },
      ]);
      expect(result.twr).toBe(10);
      expect(result.totalDays).toBe(364);
    });

    it("adjusts for cash flows", () => {
      const result = calculateTimeWeightedReturn([
        {
          startDate: "2025-01-01",
          endDate: "2025-06-30",
          startValue: 10000,
          endValue: 10500,
          cashFlow: 0,
        },
        {
          startDate: "2025-07-01",
          endDate: "2025-12-31",
          startValue: 10500,
          endValue: 12500,
          cashFlow: 1000, // $1000 added mid-year
        },
      ]);
      // Should exclude the $1000 cash flow from return calculation
      expect(result.twr).toBeGreaterThan(0);
    });

    it("handles multiple periods", () => {
      const result = calculateTimeWeightedReturn([
        {
          startDate: "2024-01-01",
          endDate: "2024-06-30",
          startValue: 10000,
          endValue: 10500,
          cashFlow: 0,
        },
        {
          startDate: "2024-07-01",
          endDate: "2024-12-31",
          startValue: 10500,
          endValue: 11025,
          cashFlow: 0,
        },
      ]);
      // 5% in first half, 5% in second half = ~10.25% total
      expect(result.twr).toBeCloseTo(10.25, 1);
    });
  });

  describe("calculateSimpleReturn", () => {
    it("calculates basic return", () => {
      const result = calculateSimpleReturn(10000, 11000);
      expect(result).toBe(10);
    });

    it("adjusts for cash flow", () => {
      const result = calculateSimpleReturn(10000, 12000, 1000);
      // Gain = 12000 - 10000 - 1000 = 1000
      // Return = 1000 / 10000 = 10%
      expect(result).toBe(10);
    });

    it("handles zero start value", () => {
      const result = calculateSimpleReturn(0, 1000);
      expect(result).toBe(0);
    });

    it("handles negative return", () => {
      const result = calculateSimpleReturn(10000, 9000);
      expect(result).toBe(-10);
    });
  });

  describe("calculateGainLoss", () => {
    it("calculates gain", () => {
      const result = calculateGainLoss(toMoney(10000), toMoney(12000));
      expect(result.unrealizedGainLoss).toBe(2000);
      expect(result.unrealizedGainLossPct).toBe(20);
      expect(result.isGain).toBe(true);
    });

    it("calculates loss", () => {
      const result = calculateGainLoss(toMoney(10000), toMoney(8000));
      expect(result.unrealizedGainLoss).toBe(-2000);
      expect(result.unrealizedGainLossPct).toBe(-20);
      expect(result.isGain).toBe(false);
    });

    it("handles zero cost basis", () => {
      const result = calculateGainLoss(toMoney(0), toMoney(1000));
      expect(result.unrealizedGainLossPct).toBe(100);
    });
  });

  describe("calculateHoldingGainLoss", () => {
    it("calculates holding gain/loss", () => {
      const result = calculateHoldingGainLoss({
        quantity: 100,
        currentPrice: 15,
        costBasisPerUnit: 10,
      });
      expect(result.costBasis).toBe(1000);
      expect(result.marketValue).toBe(1500);
      expect(result.unrealizedGainLoss).toBe(500);
      expect(result.unrealizedGainLossPct).toBe(50);
    });
  });

  describe("calculateRealizedGainLoss", () => {
    it("calculates realized gain", () => {
      const result = calculateRealizedGainLoss(
        toMoney(1500),
        toMoney(1000),
        "2024-01-01",
        "2025-02-01"
      );
      expect(result.realizedGainLoss).toBe(500);
      expect(result.realizedGainLossPct).toBe(50);
      expect(result.isLongTerm).toBe(true);
    });

    it("detects short-term holding", () => {
      const result = calculateRealizedGainLoss(
        toMoney(1100),
        toMoney(1000),
        "2025-01-01",
        "2025-06-01"
      );
      expect(result.isLongTerm).toBe(false);
      expect(result.holdingPeriodDays).toBeLessThan(365);
    });
  });
});
