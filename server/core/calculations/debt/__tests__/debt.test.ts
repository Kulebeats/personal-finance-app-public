/**
 * Tests for Debt Calculations
 *
 * @module core/calculations/debt/__tests__/debt.test
 */

import { describe, it, expect } from "vitest";
import { toMoney } from "../../types";
import {
  calculateDebtPayoff,
  sortDebtsByStrategy,
  calculateMonthlyInterest,
} from "../payoff";
import { calculateDebtToIncome, calculateAffordableDebtPayment } from "../dti";

describe("Debt Calculations", () => {
  describe("calculateDebtPayoff", () => {
    it("calculates payoff schedule", () => {
      const result = calculateDebtPayoff(
        {
          id: "1",
          name: "Credit Card",
          balance: 1000,
          apr: 18,
          minimumPayment: 25,
        },
        100 // $100/month
      );

      expect(result.originalBalance).toBe(1000);
      expect(result.monthsToPayoff).toBeGreaterThan(10);
      expect(result.monthsToPayoff).toBeLessThan(15);
      expect(result.totalInterest).toBeGreaterThan(0);
      expect(result.schedule).toHaveLength(result.monthsToPayoff);
    });

    it("handles minimum payment", () => {
      const result = calculateDebtPayoff(
        {
          id: "1",
          name: "Test",
          balance: 1000,
          apr: 12,
          minimumPayment: 100,
        },
        50 // Below minimum, should use minimum
      );

      // Should use minimum payment of $100
      expect(result.schedule[0].payment).toBe(100);
    });

    it("schedule ends with zero balance", () => {
      const result = calculateDebtPayoff(
        {
          id: "1",
          name: "Test",
          balance: 500,
          apr: 12,
          minimumPayment: 50,
        },
        100
      );

      const lastPayment = result.schedule[result.schedule.length - 1];
      expect(lastPayment.remainingBalance).toBe(0);
    });
  });

  describe("sortDebtsByStrategy", () => {
    const debts = [
      { id: "1", name: "Card A", balance: 5000, apr: 18, minimumPayment: 100 },
      { id: "2", name: "Card B", balance: 2000, apr: 22, minimumPayment: 50 },
      { id: "3", name: "Card C", balance: 8000, apr: 15, minimumPayment: 150 },
    ];

    it("avalanche sorts by highest APR", () => {
      const sorted = sortDebtsByStrategy(debts, "avalanche");
      expect(sorted[0].id).toBe("2"); // 22% APR
      expect(sorted[1].id).toBe("1"); // 18% APR
      expect(sorted[2].id).toBe("3"); // 15% APR
    });

    it("snowball sorts by lowest balance", () => {
      const sorted = sortDebtsByStrategy(debts, "snowball");
      expect(sorted[0].id).toBe("2"); // $2000
      expect(sorted[1].id).toBe("1"); // $5000
      expect(sorted[2].id).toBe("3"); // $8000
    });

    it("minimum maintains order", () => {
      const sorted = sortDebtsByStrategy(debts, "minimum");
      expect(sorted[0].id).toBe("1");
      expect(sorted[1].id).toBe("2");
      expect(sorted[2].id).toBe("3");
    });
  });

  describe("calculateMonthlyInterest", () => {
    it("calculates monthly interest", () => {
      const interest = calculateMonthlyInterest(toMoney(10000), 12);
      // 12% APR = 1% monthly
      expect(interest).toBe(100);
    });

    it("handles zero balance", () => {
      const interest = calculateMonthlyInterest(toMoney(0), 18);
      expect(interest).toBe(0);
    });
  });

  describe("calculateDebtToIncome", () => {
    it("calculates DTI ratio", () => {
      const result = calculateDebtToIncome(toMoney(1500), toMoney(5000));
      expect(result.dtiPercentage).toBe(30);
      expect(result.healthLevel).toBe("good");
    });

    it("identifies excellent DTI", () => {
      const result = calculateDebtToIncome(toMoney(500), toMoney(5000));
      expect(result.dtiPercentage).toBe(10);
      expect(result.healthLevel).toBe("excellent");
    });

    it("identifies poor DTI", () => {
      const result = calculateDebtToIncome(toMoney(2500), toMoney(5000));
      expect(result.dtiPercentage).toBe(50);
      expect(result.healthLevel).toBe("poor");
    });

    it("handles zero income", () => {
      const result = calculateDebtToIncome(toMoney(1000), toMoney(0));
      expect(result.healthLevel).toBe("poor");
    });
  });

  describe("calculateAffordableDebtPayment", () => {
    it("calculates affordable additional debt", () => {
      // Income 5000, current debt 1000 (20%), target 36%
      const affordable = calculateAffordableDebtPayment(
        toMoney(1000),
        toMoney(5000),
        36
      );
      // 36% of 5000 = 1800, minus 1000 = 800
      expect(affordable).toBe(800);
    });

    it("returns zero when at limit", () => {
      const affordable = calculateAffordableDebtPayment(
        toMoney(1800),
        toMoney(5000),
        36
      );
      expect(affordable).toBe(0);
    });

    it("returns zero when over limit", () => {
      const affordable = calculateAffordableDebtPayment(
        toMoney(2500),
        toMoney(5000),
        36
      );
      expect(affordable).toBe(0);
    });
  });
});
