/**
 * Tests for Budget Calculations
 *
 * @module core/calculations/budget/__tests__/budget.test
 */

import { describe, it, expect } from "vitest";
import { toMoney } from "../../types";
import {
  calculateBudgetProgress,
  calculateProRatedBudgetProgress,
} from "../progress";
import {
  determineBudgetStatus,
  shouldTriggerAlert,
  DEFAULT_THRESHOLDS,
} from "../alerts";

describe("Budget Calculations", () => {
  describe("calculateBudgetProgress", () => {
    it("calculates basic progress", () => {
      const result = calculateBudgetProgress(toMoney(1000), toMoney(500));
      expect(result.percentUsed).toBe(50);
      expect(result.remainingAmount).toBe(500);
      expect(result.isOverBudget).toBe(false);
    });

    it("handles exactly at budget", () => {
      const result = calculateBudgetProgress(toMoney(1000), toMoney(1000));
      expect(result.percentUsed).toBe(100);
      expect(result.remainingAmount).toBe(0);
      expect(result.isOverBudget).toBe(false);
    });

    it("handles over budget", () => {
      const result = calculateBudgetProgress(toMoney(1000), toMoney(1200));
      expect(result.percentUsed).toBe(120);
      expect(result.remainingAmount).toBe(-200);
      expect(result.isOverBudget).toBe(true);
    });

    it("handles zero budget with spending", () => {
      const result = calculateBudgetProgress(toMoney(0), toMoney(500));
      expect(result.percentUsed).toBe(100);
    });

    it("handles zero budget and spending", () => {
      const result = calculateBudgetProgress(toMoney(0), toMoney(0));
      expect(result.percentUsed).toBe(0);
    });
  });

  describe("calculateProRatedBudgetProgress", () => {
    it("calculates pro-rated progress", () => {
      const result = calculateProRatedBudgetProgress(
        toMoney(3000), // $3000 monthly budget
        toMoney(1000), // $1000 spent
        15, // 15 days elapsed
        30 // 30 days total
      );

      expect(result.proRatedBudget).toBe(1500);
      expect(result.isAheadOfPace).toBe(true);
    });

    it("detects behind pace", () => {
      const result = calculateProRatedBudgetProgress(
        toMoney(3000),
        toMoney(2000),
        15,
        30
      );

      expect(result.proRatedBudget).toBe(1500);
      expect(result.isAheadOfPace).toBe(false);
    });
  });

  describe("determineBudgetStatus", () => {
    it("returns safe for low usage", () => {
      const result = determineBudgetStatus(toMoney(500), toMoney(1000));
      expect(result.level).toBe("safe");
      expect(result.percentUsed).toBe(50);
    });

    it("returns warning at 75%+", () => {
      const result = determineBudgetStatus(toMoney(800), toMoney(1000));
      expect(result.level).toBe("warning");
    });

    it("returns danger at 90%+", () => {
      const result = determineBudgetStatus(toMoney(950), toMoney(1000));
      expect(result.level).toBe("danger");
    });

    it("returns exceeded at 100%+", () => {
      const result = determineBudgetStatus(toMoney(1100), toMoney(1000));
      expect(result.level).toBe("exceeded");
    });

    it("respects custom thresholds", () => {
      const result = determineBudgetStatus(toMoney(600), toMoney(1000), {
        warning: 50,
        danger: 80,
      });
      expect(result.level).toBe("warning");
    });
  });

  describe("shouldTriggerAlert", () => {
    it("triggers warning alert at threshold", () => {
      expect(shouldTriggerAlert(toMoney(750), toMoney(1000), "warning")).toBe(
        true
      );
    });

    it("does not trigger warning if in danger zone", () => {
      expect(shouldTriggerAlert(toMoney(950), toMoney(1000), "warning")).toBe(
        false
      );
    });

    it("triggers exceeded alert over 100%", () => {
      expect(shouldTriggerAlert(toMoney(1050), toMoney(1000), "exceeded")).toBe(
        true
      );
    });

    it("triggers safe when under warning", () => {
      expect(shouldTriggerAlert(toMoney(500), toMoney(1000), "safe")).toBe(
        true
      );
    });
  });
});

describe("Budget Edge Cases - Zero/Empty Values", () => {
  describe("calculateBudgetProgress with zeros", () => {
    it("should handle zero budget with zero spending", () => {
      const result = calculateBudgetProgress(toMoney(0), toMoney(0));
      expect(result.percentUsed).toBe(0);
      expect(result.remainingAmount).toBe(0);
      expect(result.isOverBudget).toBe(false);
    });

    it("should handle zero budget with spending", () => {
      const result = calculateBudgetProgress(toMoney(0), toMoney(500));
      expect(result.percentUsed).toBe(100);
      expect(result.remainingAmount).toBe(-500);
      expect(result.isOverBudget).toBe(true);
    });

    it("should handle budget with zero spending", () => {
      const result = calculateBudgetProgress(toMoney(1000), toMoney(0));
      expect(result.percentUsed).toBe(0);
      expect(result.remainingAmount).toBe(1000);
      expect(result.isOverBudget).toBe(false);
    });

    it("should handle very small budget", () => {
      const result = calculateBudgetProgress(toMoney(0.01), toMoney(0.01));
      expect(result.percentUsed).toBe(100);
      expect(result.remainingAmount).toBe(0);
    });
  });

  describe("calculateProRatedBudgetProgress with zeros", () => {
    it("should handle zero budget", () => {
      const result = calculateProRatedBudgetProgress(
        toMoney(0),
        toMoney(0),
        15,
        30
      );
      expect(result.proRatedBudget).toBe(0);
    });

    it("should handle zero days elapsed", () => {
      const result = calculateProRatedBudgetProgress(
        toMoney(3000),
        toMoney(0),
        0,
        30
      );
      expect(result.proRatedBudget).toBe(0);
    });

    it("should handle zero total days", () => {
      const result = calculateProRatedBudgetProgress(
        toMoney(3000),
        toMoney(1000),
        15,
        0
      );
      expect(result.proRatedBudget).toBe(0);
    });
  });
});

describe("Budget Edge Cases - Negative Values", () => {
  describe("calculateBudgetProgress with negatives", () => {
    it("should handle negative budget (income category)", () => {
      const result = calculateBudgetProgress(toMoney(-1000), toMoney(-500));
      expect(result.percentUsed).toBe(50);
      expect(result.remainingAmount).toBe(-500);
    });

    it("should handle negative spending (refunds)", () => {
      const result = calculateBudgetProgress(toMoney(1000), toMoney(-200));
      expect(result.percentUsed).toBe(-20);
      expect(result.remainingAmount).toBe(1200);
    });

    it("should handle both negative", () => {
      const result = calculateBudgetProgress(toMoney(-1000), toMoney(-1500));
      expect(result.percentUsed).toBe(150);
      expect(result.isOverBudget).toBe(true);
    });
  });

  describe("determineBudgetStatus with negatives", () => {
    it("should handle negative spending (surplus)", () => {
      const result = determineBudgetStatus(toMoney(-100), toMoney(1000));
      expect(result.level).toBe("safe");
      expect(result.percentUsed).toBe(-10);
    });
  });
});

describe("Budget Edge Cases - Boundary Conditions", () => {
  describe("calculateBudgetProgress at boundaries", () => {
    it("should handle exactly at budget (100%)", () => {
      const result = calculateBudgetProgress(toMoney(1000), toMoney(1000));
      expect(result.percentUsed).toBe(100);
      expect(result.remainingAmount).toBe(0);
      expect(result.isOverBudget).toBe(false);
    });

    it("should handle just under budget", () => {
      const result = calculateBudgetProgress(toMoney(1000), toMoney(999.99));
      expect(result.percentUsed).toBeCloseTo(99.999, 2);
      expect(result.isOverBudget).toBe(false);
    });

    it("should handle just over budget", () => {
      const result = calculateBudgetProgress(toMoney(1000), toMoney(1000.01));
      expect(result.percentUsed).toBeCloseTo(100.001, 2);
      expect(result.isOverBudget).toBe(true);
    });
  });

  describe("determineBudgetStatus at threshold boundaries", () => {
    it("should return safe at 74.99%", () => {
      const result = determineBudgetStatus(toMoney(749.9), toMoney(1000));
      expect(result.level).toBe("safe");
    });

    it("should return warning at exactly 75%", () => {
      const result = determineBudgetStatus(toMoney(750), toMoney(1000));
      expect(result.level).toBe("warning");
    });

    it("should return warning at 89.99%", () => {
      const result = determineBudgetStatus(toMoney(899.9), toMoney(1000));
      expect(result.level).toBe("warning");
    });

    it("should return danger at exactly 90%", () => {
      const result = determineBudgetStatus(toMoney(900), toMoney(1000));
      expect(result.level).toBe("danger");
    });

    it("should return danger at 99.99%", () => {
      const result = determineBudgetStatus(toMoney(999.9), toMoney(1000));
      expect(result.level).toBe("danger");
    });

    it("should return exceeded at exactly 100%", () => {
      const result = determineBudgetStatus(toMoney(1000), toMoney(1000));
      expect(result.level).toBe("exceeded");
    });

    it("should return exceeded at 100.01%", () => {
      const result = determineBudgetStatus(toMoney(1000.1), toMoney(1000));
      expect(result.level).toBe("exceeded");
    });
  });

  describe("shouldTriggerAlert at boundaries", () => {
    it("should trigger warning at exactly 75%", () => {
      expect(shouldTriggerAlert(toMoney(750), toMoney(1000), "warning")).toBe(
        true
      );
    });

    it("should trigger danger at exactly 90%", () => {
      expect(shouldTriggerAlert(toMoney(900), toMoney(1000), "danger")).toBe(
        true
      );
    });

    it("should trigger exceeded at exactly 100%", () => {
      expect(shouldTriggerAlert(toMoney(1000), toMoney(1000), "exceeded")).toBe(
        true
      );
    });
  });
});

describe("Budget Edge Cases - Pro-Rated Calculations", () => {
  describe("calculateProRatedBudgetProgress edge cases", () => {
    it("should handle first day of month", () => {
      const result = calculateProRatedBudgetProgress(
        toMoney(3000),
        toMoney(0),
        1,
        30
      );
      expect(result.proRatedBudget).toBe(100);
      expect(result.isAheadOfPace).toBe(true);
    });

    it("should handle last day of month", () => {
      const result = calculateProRatedBudgetProgress(
        toMoney(3000),
        toMoney(3000),
        30,
        30
      );
      expect(result.proRatedBudget).toBe(3000);
      expect(result.isAheadOfPace).toBe(true);
    });

    it("should handle spending exactly at pace", () => {
      const result = calculateProRatedBudgetProgress(
        toMoney(3000),
        toMoney(1500),
        15,
        30
      );
      expect(result.proRatedBudget).toBe(1500);
      expect(result.isAheadOfPace).toBe(true);
    });

    it("should handle 31-day month", () => {
      const result = calculateProRatedBudgetProgress(
        toMoney(3100),
        toMoney(1000),
        10,
        31
      );
      expect(result.proRatedBudget).toBe(1000);
    });

    it("should handle February (28 days)", () => {
      const result = calculateProRatedBudgetProgress(
        toMoney(2800),
        toMoney(1000),
        10,
        28
      );
      expect(result.proRatedBudget).toBe(1000);
    });

    it("should handle leap year February (29 days)", () => {
      const result = calculateProRatedBudgetProgress(
        toMoney(2900),
        toMoney(1000),
        10,
        29
      );
      expect(result.proRatedBudget).toBe(1000);
    });
  });
});

describe("Budget Edge Cases - Custom Thresholds", () => {
  describe("determineBudgetStatus with custom thresholds", () => {
    it("should respect very low warning threshold", () => {
      const result = determineBudgetStatus(toMoney(400), toMoney(1000), {
        warning: 40,
        danger: 80,
      });
      expect(result.level).toBe("warning");
    });

    it("should respect very high danger threshold", () => {
      const result = determineBudgetStatus(toMoney(950), toMoney(1000), {
        warning: 75,
        danger: 95,
      });
      expect(result.level).toBe("danger");
    });

    it("should handle threshold at 0", () => {
      const result = determineBudgetStatus(toMoney(1), toMoney(1000), {
        warning: 0,
        danger: 50,
      });
      expect(result.level).toBe("warning");
    });

    it("should handle same warning and danger threshold", () => {
      const result = determineBudgetStatus(toMoney(800), toMoney(1000), {
        warning: 80,
        danger: 80,
      });
      expect(result.level).toBe("danger");
    });
  });
});

describe("Budget Edge Cases - Very Large Numbers", () => {
  describe("calculateBudgetProgress with large budgets", () => {
    it("should handle million-dollar budget", () => {
      const result = calculateBudgetProgress(
        toMoney(1000000),
        toMoney(500000)
      );
      expect(result.percentUsed).toBe(50);
      expect(result.remainingAmount).toBe(500000);
    });

    it("should handle very large spending", () => {
      const result = calculateBudgetProgress(
        toMoney(1000000),
        toMoney(1500000)
      );
      expect(result.percentUsed).toBe(150);
      expect(result.isOverBudget).toBe(true);
    });
  });
});
