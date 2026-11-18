/**
 * Tests for Goal Calculations
 *
 * @module core/calculations/goals/__tests__/goals.test
 */

import { describe, it, expect } from "vitest";
import { toMoney } from "../../types";
import {
  calculateGoalProgress,
  calculatePercentComplete,
  calculateAnnualGoalProgress,
} from "../progress";
import { determineGoalStatus } from "../status";
import {
  calculateGoalProjection,
  calculateRequiredMonthlyContribution,
} from "../projections";

describe("Goal Calculations", () => {
  describe("calculateGoalProgress", () => {
    it("calculates basic progress", () => {
      const result = calculateGoalProgress(toMoney(5000), toMoney(10000));
      expect(result.percentComplete).toBe(50);
      expect(result.remainingAmount).toBe(5000);
      expect(result.isComplete).toBe(false);
    });

    it("handles completed goal", () => {
      const result = calculateGoalProgress(toMoney(10000), toMoney(10000));
      expect(result.percentComplete).toBe(100);
      expect(result.remainingAmount).toBe(0);
      expect(result.isComplete).toBe(true);
    });

    it("handles over-funded goal", () => {
      const result = calculateGoalProgress(toMoney(12000), toMoney(10000));
      expect(result.percentComplete).toBe(120);
      expect(result.remainingAmount).toBe(0);
      expect(result.isComplete).toBe(true);
    });

    it("handles zero target", () => {
      const result = calculateGoalProgress(toMoney(5000), toMoney(0));
      expect(result.percentComplete).toBe(100);
    });

    it("handles zero current and zero target", () => {
      const result = calculateGoalProgress(toMoney(0), toMoney(0));
      expect(result.percentComplete).toBe(0);
    });

    it("rounds to 2 decimal places", () => {
      const result = calculateGoalProgress(toMoney(1000), toMoney(3000));
      expect(result.percentComplete).toBeCloseTo(33.33, 2);
    });
  });

  describe("calculatePercentComplete", () => {
    it("returns simple percentage", () => {
      const percent = calculatePercentComplete(toMoney(2500), toMoney(10000));
      expect(percent).toBe(25);
    });
  });

  describe("calculateAnnualGoalProgress", () => {
    it("measures progress against the pro-rated (pace) target", () => {
      // SCP-337: progress is measured against the pro-rated target (the monthly
      // pace), not the full annual target. 6000 saved by month 6 on a 1000/month
      // plan is exactly on pace — 100% of the 6000 expected so far. (The old
      // assertion here used a 12000 annual target / 50%, which contradicted the
      // month-0 and fractional-month edge cases below; pace is the coherent rule.)
      const result = calculateAnnualGoalProgress(
        toMoney(6000),
        toMoney(1000),
        6 // 6 months in
      );
      expect(result.targetAmount).toBe(6000); // pro-rated target by month 6
      expect(result.percentComplete).toBe(100); // 6000/6000 — on pace
    });
  });

  describe("determineGoalStatus", () => {
    it("returns completed for finished goals", () => {
      const result = determineGoalStatus({
        currentAmount: toMoney(10000),
        targetAmount: toMoney(10000),
        startDate: "2025-01-01",
        targetDate: "2025-12-31",
        currentDate: "2025-06-15",
      });
      expect(result.status).toBe("completed");
    });

    it("returns overdue for past-due goals", () => {
      const result = determineGoalStatus({
        currentAmount: toMoney(5000),
        targetAmount: toMoney(10000),
        startDate: "2024-01-01",
        targetDate: "2024-12-31",
        currentDate: "2025-06-15",
      });
      expect(result.status).toBe("overdue");
    });

    it("returns on_track when close to expected", () => {
      const result = determineGoalStatus({
        currentAmount: toMoney(5000),
        targetAmount: toMoney(10000),
        startDate: "2025-01-01",
        targetDate: "2025-12-31",
        currentDate: "2025-07-01", // ~50% through year
      });
      expect(result.status).toBe("on_track");
    });

    it("returns at_risk when far behind", () => {
      const result = determineGoalStatus({
        currentAmount: toMoney(1000),
        targetAmount: toMoney(10000),
        startDate: "2025-01-01",
        targetDate: "2025-12-31",
        currentDate: "2025-07-01",
      });
      expect(result.status).toBe("at_risk");
    });
  });

  describe("calculateGoalProjection", () => {
    it("calculates projection at current rate", () => {
      const result = calculateGoalProjection({
        currentAmount: toMoney(5000),
        targetAmount: toMoney(10000),
        targetDate: "2025-12-31",
        recentContributions: toMoney(1000),
        contributionPeriodDays: 30,
        currentDate: "2025-06-15",
      });

      expect(result.currentMonthlyRate).toBe(1000);
      expect(result.isAchievable).toBe(true);
    });

    it("handles zero contributions", () => {
      const result = calculateGoalProjection({
        currentAmount: toMoney(5000),
        targetAmount: toMoney(10000),
        targetDate: "2025-12-31",
        recentContributions: toMoney(0),
        contributionPeriodDays: 30,
        currentDate: "2025-06-15",
      });

      expect(result.projectedCompletionDate).toBe("never");
      expect(result.isAchievable).toBe(false);
    });

    it("handles already complete goal", () => {
      const result = calculateGoalProjection({
        currentAmount: toMoney(10000),
        targetAmount: toMoney(10000),
        targetDate: "2025-12-31",
        recentContributions: toMoney(1000),
        contributionPeriodDays: 30,
        currentDate: "2025-06-15",
      });

      expect(result.daysToCompletion).toBe(0);
    });
  });

  describe("calculateRequiredMonthlyContribution", () => {
    it("calculates required contribution", () => {
      const required = calculateRequiredMonthlyContribution(toMoney(6000), 6);
      expect(required).toBe(1000);
    });

    it("handles zero months remaining", () => {
      const required = calculateRequiredMonthlyContribution(toMoney(6000), 0);
      expect(required).toBe(0);
    });

    it("handles zero remaining amount", () => {
      const required = calculateRequiredMonthlyContribution(toMoney(0), 6);
      expect(required).toBe(0);
    });
  });
});

describe("Goals Edge Cases - Zero/Empty Values", () => {
  describe("calculateGoalProgress with zeros", () => {
    it("should handle zero current and zero target", () => {
      const result = calculateGoalProgress(toMoney(0), toMoney(0));
      expect(result.percentComplete).toBe(0);
      expect(result.remainingAmount).toBe(0);
      expect(result.isComplete).toBe(false);
    });

    it("should handle zero current with target", () => {
      const result = calculateGoalProgress(toMoney(0), toMoney(10000));
      expect(result.percentComplete).toBe(0);
      expect(result.remainingAmount).toBe(10000);
      expect(result.isComplete).toBe(false);
    });

    it("should handle current with zero target", () => {
      const result = calculateGoalProgress(toMoney(5000), toMoney(0));
      expect(result.percentComplete).toBe(100);
      expect(result.remainingAmount).toBe(0);
      expect(result.isComplete).toBe(true);
    });

    it("should handle very small amounts", () => {
      const result = calculateGoalProgress(toMoney(0.01), toMoney(0.02));
      expect(result.percentComplete).toBe(50);
      expect(result.remainingAmount).toBe(0.01);
    });
  });

  describe("calculateRequiredMonthlyContribution with zeros", () => {
    it("should handle zero remaining amount", () => {
      const required = calculateRequiredMonthlyContribution(toMoney(0), 6);
      expect(required).toBe(0);
    });

    it("should handle zero months remaining", () => {
      const required = calculateRequiredMonthlyContribution(toMoney(6000), 0);
      expect(required).toBe(0);
    });

    it("should handle both zero", () => {
      const required = calculateRequiredMonthlyContribution(toMoney(0), 0);
      expect(required).toBe(0);
    });
  });

  describe("calculateGoalProjection with zero contributions", () => {
    it("should handle zero contributions", () => {
      const result = calculateGoalProjection({
        currentAmount: toMoney(5000),
        targetAmount: toMoney(10000),
        targetDate: "2025-12-31",
        recentContributions: toMoney(0),
        contributionPeriodDays: 30,
        currentDate: "2025-06-15",
      });
      expect(result.currentMonthlyRate).toBe(0);
      expect(result.projectedCompletionDate).toBe("never");
      expect(result.isAchievable).toBe(false);
    });

    it("should handle zero contribution period days", () => {
      const result = calculateGoalProjection({
        currentAmount: toMoney(5000),
        targetAmount: toMoney(10000),
        targetDate: "2025-12-31",
        recentContributions: toMoney(1000),
        contributionPeriodDays: 0,
        currentDate: "2025-06-15",
      });
      expect(result.currentMonthlyRate).toBe(0);
    });
  });
});

describe("Goals Edge Cases - Negative Values", () => {
  describe("calculateGoalProgress with negatives", () => {
    it("should handle negative current amount (debt)", () => {
      const result = calculateGoalProgress(toMoney(-1000), toMoney(10000));
      expect(result.percentComplete).toBeLessThan(0);
      expect(result.remainingAmount).toBeGreaterThan(10000);
      expect(result.isComplete).toBe(false);
    });

    it("should handle negative target (debt payoff goal)", () => {
      const result = calculateGoalProgress(toMoney(-5000), toMoney(-10000));
      expect(result.percentComplete).toBe(50);
      expect(result.isComplete).toBe(false);
    });
  });

  describe("calculateRequiredMonthlyContribution with negatives", () => {
    it("should handle negative remaining amount", () => {
      const required = calculateRequiredMonthlyContribution(
        toMoney(-1000),
        6
      );
      expect(required).toBeLessThan(0);
    });

    it("should handle negative months (past due)", () => {
      const required = calculateRequiredMonthlyContribution(toMoney(6000), -6);
      expect(required).toBeLessThan(0);
    });
  });
});

describe("Goals Edge Cases - Boundary Conditions", () => {
  describe("calculateGoalProgress at boundaries", () => {
    it("should handle exactly at target (100%)", () => {
      const result = calculateGoalProgress(toMoney(10000), toMoney(10000));
      expect(result.percentComplete).toBe(100);
      expect(result.remainingAmount).toBe(0);
      expect(result.isComplete).toBe(true);
    });

    it("should handle just under target", () => {
      const result = calculateGoalProgress(toMoney(9999.99), toMoney(10000));
      expect(result.percentComplete).toBeCloseTo(99.9999, 2);
      expect(result.isComplete).toBe(false);
    });

    it("should handle just over target", () => {
      const result = calculateGoalProgress(toMoney(10000.01), toMoney(10000));
      expect(result.percentComplete).toBeGreaterThan(100);
      expect(result.isComplete).toBe(true);
    });

    it("should handle 2x target (200%)", () => {
      const result = calculateGoalProgress(toMoney(20000), toMoney(10000));
      expect(result.percentComplete).toBe(200);
      expect(result.remainingAmount).toBe(0);
      expect(result.isComplete).toBe(true);
    });
  });

  describe("determineGoalStatus at date boundaries", () => {
    it("should return completed when exactly at target on target date", () => {
      const result = determineGoalStatus({
        currentAmount: toMoney(10000),
        targetAmount: toMoney(10000),
        startDate: "2025-01-01",
        targetDate: "2025-12-31",
        currentDate: "2025-12-31",
      });
      expect(result.status).toBe("completed");
    });

    it("should return overdue one day after target date", () => {
      const result = determineGoalStatus({
        currentAmount: toMoney(5000),
        targetAmount: toMoney(10000),
        startDate: "2025-01-01",
        targetDate: "2025-12-31",
        currentDate: "2026-01-01",
      });
      expect(result.status).toBe("overdue");
    });

    it("should handle goal on start date", () => {
      const result = determineGoalStatus({
        currentAmount: toMoney(0),
        targetAmount: toMoney(10000),
        startDate: "2025-01-01",
        targetDate: "2025-12-31",
        currentDate: "2025-01-01",
      });
      expect(result.status).toBe("on_track");
    });
  });
});

describe("Goals Edge Cases - Very Large Numbers", () => {
  describe("calculateGoalProgress with large goals", () => {
    it("should handle million-dollar goal", () => {
      const result = calculateGoalProgress(
        toMoney(500000),
        toMoney(1000000)
      );
      expect(result.percentComplete).toBe(50);
      expect(result.remainingAmount).toBe(500000);
    });

    it("should handle very large overfunding", () => {
      const result = calculateGoalProgress(
        toMoney(10000000),
        toMoney(1000000)
      );
      expect(result.percentComplete).toBe(1000);
      expect(result.isComplete).toBe(true);
    });
  });

  describe("calculateRequiredMonthlyContribution with large amounts", () => {
    it("should handle large goal amount", () => {
      const required = calculateRequiredMonthlyContribution(
        toMoney(1000000),
        120
      );
      expect(required).toBeCloseTo(8333.33, 2);
    });

    it("should handle many years remaining", () => {
      const required = calculateRequiredMonthlyContribution(
        toMoney(100000),
        360
      );
      expect(required).toBeCloseTo(277.78, 2);
    });
  });
});

describe("Goals Edge Cases - Annual Goal Progress", () => {
  describe("calculateAnnualGoalProgress edge cases", () => {
    it("should handle month 0 (start of year)", () => {
      const result = calculateAnnualGoalProgress(
        toMoney(0),
        toMoney(1000),
        0
      );
      expect(result.targetAmount).toBe(0);
      expect(result.percentComplete).toBe(0);
    });

    it("should handle month 12 (end of year)", () => {
      const result = calculateAnnualGoalProgress(
        toMoney(12000),
        toMoney(1000),
        12
      );
      expect(result.targetAmount).toBe(12000);
      expect(result.percentComplete).toBe(100);
    });

    it("should handle fractional months", () => {
      const result = calculateAnnualGoalProgress(
        toMoney(1500),
        toMoney(1000),
        1.5
      );
      expect(result.targetAmount).toBe(1500);
      expect(result.percentComplete).toBe(100);
    });
  });
});

describe("Goals Edge Cases - Projection Calculations", () => {
  describe("calculateGoalProjection edge cases", () => {
    it("should handle already complete goal", () => {
      const result = calculateGoalProjection({
        currentAmount: toMoney(10000),
        targetAmount: toMoney(10000),
        targetDate: "2025-12-31",
        recentContributions: toMoney(1000),
        contributionPeriodDays: 30,
        currentDate: "2025-06-15",
      });
      expect(result.daysToCompletion).toBe(0);
      expect(result.isAchievable).toBe(true);
    });

    it("should handle over-complete goal", () => {
      const result = calculateGoalProjection({
        currentAmount: toMoney(12000),
        targetAmount: toMoney(10000),
        targetDate: "2025-12-31",
        recentContributions: toMoney(1000),
        contributionPeriodDays: 30,
        currentDate: "2025-06-15",
      });
      expect(result.daysToCompletion).toBe(0);
      expect(result.isAchievable).toBe(true);
    });

    it("should handle very slow contribution rate", () => {
      const result = calculateGoalProjection({
        currentAmount: toMoney(1000),
        targetAmount: toMoney(10000),
        targetDate: "2025-12-31",
        recentContributions: toMoney(10),
        contributionPeriodDays: 30,
        currentDate: "2025-06-15",
      });
      expect(result.currentMonthlyRate).toBe(10);
      expect(result.isAchievable).toBe(false);
    });

    it("should handle very fast contribution rate", () => {
      const result = calculateGoalProjection({
        currentAmount: toMoney(5000),
        targetAmount: toMoney(10000),
        targetDate: "2025-12-31",
        recentContributions: toMoney(5000),
        contributionPeriodDays: 30,
        currentDate: "2025-06-15",
      });
      expect(result.currentMonthlyRate).toBe(5000);
      expect(result.isAchievable).toBe(true);
    });

    it("should handle target date in the past", () => {
      const result = calculateGoalProjection({
        currentAmount: toMoney(5000),
        targetAmount: toMoney(10000),
        targetDate: "2024-12-31",
        recentContributions: toMoney(1000),
        contributionPeriodDays: 30,
        currentDate: "2025-06-15",
      });
      expect(result.isAchievable).toBe(false);
    });
  });
});

describe("Goals Edge Cases - Status Determination", () => {
  describe("determineGoalStatus with various progress levels", () => {
    it("should return on_track at 50% progress at 50% time", () => {
      const result = determineGoalStatus({
        currentAmount: toMoney(5000),
        targetAmount: toMoney(10000),
        startDate: "2025-01-01",
        targetDate: "2025-12-31",
        currentDate: "2025-07-01",
      });
      expect(result.status).toBe("on_track");
    });

    it("should return at_risk at 10% progress at 50% time", () => {
      const result = determineGoalStatus({
        currentAmount: toMoney(1000),
        targetAmount: toMoney(10000),
        startDate: "2025-01-01",
        targetDate: "2025-12-31",
        currentDate: "2025-07-01",
      });
      expect(result.status).toBe("at_risk");
    });

    it("should return on_track when ahead of schedule", () => {
      const result = determineGoalStatus({
        currentAmount: toMoney(7000),
        targetAmount: toMoney(10000),
        startDate: "2025-01-01",
        targetDate: "2025-12-31",
        currentDate: "2025-07-01",
      });
      expect(result.status).toBe("on_track");
    });

    it("should handle goal with no progress yet", () => {
      const result = determineGoalStatus({
        currentAmount: toMoney(0),
        targetAmount: toMoney(10000),
        startDate: "2025-01-01",
        targetDate: "2025-12-31",
        currentDate: "2025-01-15",
      });
      expect(result.status).toBe("on_track");
    });
  });
});

describe("Goals Edge Cases - Percentage Calculations", () => {
  describe("calculatePercentComplete edge cases", () => {
    it("should handle 0/0 percentage", () => {
      const percent = calculatePercentComplete(toMoney(0), toMoney(0));
      expect(percent).toBe(0);
    });

    it("should handle very small percentage", () => {
      const percent = calculatePercentComplete(toMoney(1), toMoney(1000000));
      expect(percent).toBeCloseTo(0, 5);
    });

    it("should handle very large percentage (over-funded)", () => {
      const percent = calculatePercentComplete(toMoney(1000000), toMoney(1000));
      expect(percent).toBe(100000);
    });

    it("should handle fractional percentages", () => {
      const percent = calculatePercentComplete(toMoney(3333), toMoney(10000));
      expect(percent).toBeCloseTo(33.33, 2);
    });
  });
});
