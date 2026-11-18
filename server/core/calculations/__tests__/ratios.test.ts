/**
 * Tests for Financial Ratios and Date Utilities
 *
 * @module core/calculations/__tests__/ratios.test
 */

import { describe, it, expect } from "vitest";
import { toMoney } from "../types";
import {
  calculateEmergencyFundRatio,
  calculateExpenseRatio,
  calculateLiquidityRatio,
  calculateHousingRatio,
} from "../ratios";
import {
  getPeriodDates,
  getPreviousPeriodDates,
  daysBetween,
  monthsBetween,
  startOfMonth,
  endOfMonth,
  addMonths,
} from "../dates";

describe("Financial Ratios", () => {
  describe("calculateEmergencyFundRatio", () => {
    it("calculates months of coverage", () => {
      const result = calculateEmergencyFundRatio(toMoney(15000), toMoney(3000));
      expect(result.monthsCovered).toBe(5);
      expect(result.isAdequate).toBe(true);
    });

    it("identifies inadequate fund", () => {
      const result = calculateEmergencyFundRatio(toMoney(6000), toMoney(4000));
      expect(result.monthsCovered).toBe(1.5);
      expect(result.isAdequate).toBe(false);
    });

    it("handles zero expenses", () => {
      const result = calculateEmergencyFundRatio(toMoney(10000), toMoney(0));
      // Returns 999 (large finite value) instead of Infinity
      expect(result.monthsCovered).toBe(999);
      expect(result.isAdequate).toBe(true);
    });

    it("respects custom minimum", () => {
      const result = calculateEmergencyFundRatio(
        toMoney(15000),
        toMoney(3000),
        6
      );
      expect(result.monthsCovered).toBe(5);
      expect(result.isAdequate).toBe(false); // Need 6 months
    });
  });

  describe("calculateExpenseRatio", () => {
    it("calculates expense percentage", () => {
      const result = calculateExpenseRatio(toMoney(4000), toMoney(5000));
      expect(result.percentage).toBe(80);
    });

    it("handles zero income", () => {
      const result = calculateExpenseRatio(toMoney(1000), toMoney(0));
      expect(result.percentage).toBe(100);
    });
  });

  describe("calculateLiquidityRatio", () => {
    it("calculates months of liquidity", () => {
      const ratio = calculateLiquidityRatio(toMoney(12000), toMoney(4000));
      expect(ratio).toBe(3);
    });
  });

  describe("calculateHousingRatio", () => {
    it("calculates housing percentage", () => {
      const result = calculateHousingRatio(toMoney(1200), toMoney(5000));
      expect(result.percentage).toBe(24);
      expect(result.isWithinGuideline).toBe(true);
    });

    it("identifies over guideline", () => {
      const result = calculateHousingRatio(toMoney(1800), toMoney(5000));
      expect(result.percentage).toBe(36);
      expect(result.isWithinGuideline).toBe(false);
    });
  });
});

describe("Date Utilities", () => {
  describe("getPeriodDates", () => {
    it("gets month dates", () => {
      const result = getPeriodDates("month", new Date("2025-06-15"));
      expect(result.start).toBe("2025-06-01");
      expect(result.end).toBe("2025-06-30");
    });

    it("gets quarter dates", () => {
      const result = getPeriodDates("quarter", new Date("2025-06-15"));
      expect(result.start).toBe("2025-04-01");
      expect(result.end).toBe("2025-06-30");
    });

    it("gets year dates", () => {
      const result = getPeriodDates("year", new Date("2025-06-15"));
      expect(result.start).toBe("2025-01-01");
      expect(result.end).toBe("2025-12-31");
    });
  });

  describe("getPreviousPeriodDates", () => {
    it("gets previous month", () => {
      const result = getPreviousPeriodDates("month", new Date("2025-06-15"));
      expect(result.start).toBe("2025-05-01");
      expect(result.end).toBe("2025-05-31");
    });
  });

  describe("daysBetween", () => {
    it("calculates days", () => {
      const days = daysBetween("2025-01-01", "2025-01-31");
      expect(days).toBe(30);
    });
  });

  describe("monthsBetween", () => {
    it("calculates months", () => {
      const months = monthsBetween("2025-01-15", "2025-06-15");
      expect(months).toBe(5);
    });

    it("handles year crossing", () => {
      const months = monthsBetween("2024-11-01", "2025-02-01");
      expect(months).toBe(3);
    });
  });

  describe("startOfMonth/endOfMonth", () => {
    it("gets start of month", () => {
      expect(startOfMonth("2025-06-15")).toBe("2025-06-01");
    });

    it("gets end of month", () => {
      expect(endOfMonth("2025-06-15")).toBe("2025-06-30");
    });

    it("handles February", () => {
      expect(endOfMonth("2024-02-15")).toBe("2024-02-29"); // Leap year
      expect(endOfMonth("2025-02-15")).toBe("2025-02-28");
    });
  });

  describe("addMonths", () => {
    it("adds months", () => {
      expect(addMonths("2025-01-15", 3)).toBe("2025-04-15");
    });

    it("handles year crossing", () => {
      expect(addMonths("2025-11-15", 3)).toBe("2026-02-15");
    });
  });
});

describe("Edge Cases - Zero and Negative Values", () => {
  it("should handle zero balance in emergency fund", () => {
    const result = calculateEmergencyFundRatio(toMoney(0), toMoney(3000));
    expect(result.monthsCovered).toBe(0);
    expect(result.isAdequate).toBe(false);
  });

  it("should handle negative balance", () => {
    const result = calculateEmergencyFundRatio(toMoney(-1000), toMoney(3000));
    expect(result.monthsCovered).toBeLessThan(0);
  });

  it("should handle zero expenses in expense ratio", () => {
    const result = calculateExpenseRatio(toMoney(0), toMoney(5000));
    expect(result.percentage).toBe(0);
  });

  it("should handle negative expenses", () => {
    const result = calculateExpenseRatio(toMoney(-500), toMoney(5000));
    expect(result.percentage).toBe(-10);
  });

  it("should handle zero housing cost", () => {
    const result = calculateHousingRatio(toMoney(0), toMoney(5000));
    expect(result.percentage).toBe(0);
    expect(result.isWithinGuideline).toBe(true);
  });
});

describe("Edge Cases - Boundary Conditions", () => {
  it("should detect housing at 28% threshold", () => {
    const result = calculateHousingRatio(toMoney(2800), toMoney(10000));
    expect(result.percentage).toBe(28);
    expect(result.isWithinGuideline).toBe(true);
  });

  it("should detect housing over 28% threshold", () => {
    const result = calculateHousingRatio(toMoney(2900), toMoney(10000));
    expect(result.percentage).toBe(29);
    expect(result.isWithinGuideline).toBe(false);
  });

  it("should handle exactly at emergency fund minimum", () => {
    const result = calculateEmergencyFundRatio(toMoney(9000), toMoney(3000), 3);
    expect(result.monthsCovered).toBe(3);
    expect(result.isAdequate).toBe(true);
  });
});
