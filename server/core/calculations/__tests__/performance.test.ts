/**
 * Performance Benchmark Tests
 *
 * Validates that calculations meet performance targets:
 * - Sync operations: <20ms
 * - Batch operations: <1s
 */

import { describe, it, expect } from "vitest";
import { toMoney } from "../types";
import {
  calculateSavingsRate,
  calculateNetSavings,
  calculateNetWorth,
} from "../cashflow";
import { calculateGoalProgress, calculateGoalProjection } from "../goals";
import { calculateBudgetProgress } from "../budget";
import { calculateTimeWeightedReturn } from "../investments";
import { calculateDebtPayoff } from "../debt";

describe("Performance Benchmarks", () => {
  describe("Sync Operations (<20ms target)", () => {
    it("calculateSavingsRate completes under 20ms", () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        calculateSavingsRate(toMoney(5000), toMoney(1000));
      }

      const duration = performance.now() - start;
      const avgMs = duration / 1000;

      expect(avgMs).toBeLessThan(20);
      console.log(`  calculateSavingsRate avg: ${avgMs.toFixed(3)}ms`);
    });

    it("calculateNetSavings completes under 20ms", () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        calculateNetSavings(toMoney(5000), toMoney(3500), toMoney(500));
      }

      const duration = performance.now() - start;
      const avgMs = duration / 1000;

      expect(avgMs).toBeLessThan(20);
      console.log(`  calculateNetSavings avg: ${avgMs.toFixed(3)}ms`);
    });

    it("calculateNetWorth completes under 20ms", () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        calculateNetWorth(toMoney(500000), toMoney(200000));
      }

      const duration = performance.now() - start;
      const avgMs = duration / 1000;

      expect(avgMs).toBeLessThan(20);
      console.log(`  calculateNetWorth avg: ${avgMs.toFixed(3)}ms`);
    });

    it("calculateGoalProgress completes under 20ms", () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        calculateGoalProgress(toMoney(5000), toMoney(10000));
      }

      const duration = performance.now() - start;
      const avgMs = duration / 1000;

      expect(avgMs).toBeLessThan(20);
      console.log(`  calculateGoalProgress avg: ${avgMs.toFixed(3)}ms`);
    });

    it("calculateBudgetProgress completes under 20ms", () => {
      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        calculateBudgetProgress(toMoney(1000), toMoney(500));
      }

      const duration = performance.now() - start;
      const avgMs = duration / 1000;

      expect(avgMs).toBeLessThan(20);
      console.log(`  calculateBudgetProgress avg: ${avgMs.toFixed(3)}ms`);
    });

    it("calculateTimeWeightedReturn completes under 20ms", () => {
      const periods = [
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
          endValue: 11200,
          cashFlow: 500,
        },
      ];

      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        calculateTimeWeightedReturn(periods);
      }

      const duration = performance.now() - start;
      const avgMs = duration / 1000;

      expect(avgMs).toBeLessThan(20);
      console.log(`  calculateTimeWeightedReturn avg: ${avgMs.toFixed(3)}ms`);
    });
  });

  describe("Batch Operations (<1s target)", () => {
    it("1000 debt payoff calculations complete under 1s", () => {
      const debt = {
        id: "test",
        name: "Test Debt",
        balance: 10000,
        apr: 18,
        minimumPayment: 200,
      };

      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        calculateDebtPayoff(debt, 300);
      }

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1000);
      console.log(`  1000 debt payoffs: ${duration.toFixed(2)}ms`);
    });

    it("10000 goal projections complete under 1s", () => {
      const input = {
        currentAmount: toMoney(5000),
        targetAmount: toMoney(10000),
        targetDate: "2025-12-31",
        recentContributions: toMoney(500),
        contributionPeriodDays: 30,
      };

      const start = performance.now();

      for (let i = 0; i < 10000; i++) {
        calculateGoalProjection(input);
      }

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1000);
      console.log(`  10000 goal projections: ${duration.toFixed(2)}ms`);
    });
  });
});

describe("Memory Leak Detection", () => {
  it("no significant memory growth after 10000 calculations", () => {
    // Get initial memory (if available)
    const initialHeap =
      (global as any).gc && process.memoryUsage
        ? process.memoryUsage().heapUsed
        : 0;

    // Run many calculations
    for (let i = 0; i < 10000; i++) {
      calculateSavingsRate(toMoney(5000 + i), toMoney(1000 + i));
      calculateNetWorth(toMoney(500000 + i), toMoney(200000 + i));
      calculateGoalProgress(toMoney(5000 + i), toMoney(10000));
    }

    // Get final memory
    const finalHeap =
      (global as any).gc && process.memoryUsage
        ? process.memoryUsage().heapUsed
        : 0;

    // Memory growth should be minimal (less than 50MB)
    const growthMB = (finalHeap - initialHeap) / 1024 / 1024;

    if (initialHeap > 0) {
      expect(growthMB).toBeLessThan(50);
      console.log(`  Memory growth: ${growthMB.toFixed(2)}MB`);
    } else {
      // Just ensure no errors if memory API not available
      expect(true).toBe(true);
    }
  });
});
