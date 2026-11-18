import { describe, it, expect } from "vitest";
import {
  linearRegression,
  generateForecast,
  classifyExpense,
} from "../forecasting";

describe("Forecasting Utility", () => {
  describe("linearRegression", () => {
    it("calculates slope and intercept correctly for a simple linear increase", () => {
      // y = 2x + 1
      const data = [
        { x: 0, y: 1 },
        { x: 1, y: 3 },
        { x: 2, y: 5 },
        { x: 3, y: 7 },
      ];

      const result = linearRegression(data);
      expect(result.slope).toBeCloseTo(2);
      expect(result.intercept).toBeCloseTo(1);
    });

    it("calculates slope and intercept correctly for a linear decrease", () => {
      // y = -1x + 10
      const data = [
        { x: 0, y: 10 },
        { x: 1, y: 9 },
        { x: 2, y: 8 },
        { x: 3, y: 7 },
      ];

      const result = linearRegression(data);
      expect(result.slope).toBeCloseTo(-1);
      expect(result.intercept).toBeCloseTo(10);
    });
  });

  describe("generateForecast", () => {
    it("predicts next values using linear regression", () => {
      const values = [
        { x: 0, y: 10 },
        { x: 1, y: 20 },
        { x: 2, y: 30 },
        { x: 3, y: 40 },
      ];

      // Next is x=4, should be 50.
      const result = generateForecast(values, 1);

      expect(result.projection[0].predicted).toBeCloseTo(50);
      expect(result.regression.slope).toBeCloseTo(10);
    });

    it("calculates confidence intervals", () => {
      const values = [
        { x: 0, y: 10 },
        { x: 1, y: 20 },
        { x: 2, y: 30 },
        { x: 3, y: 40 },
      ];
      const result = generateForecast(values, 1, 0.95);

      // With perfect fit, margin might be small?
      // Standard error logic in implementation:
      // const standardError = n > 2 ? Math.sqrt(ssResidual / (n - 2)) : 0;
      // For perfect line, ssResidual is 0 -> SE is 0 -> margin is 0.
      expect(result.projection[0].lowerBound).toBeCloseTo(50);
      expect(result.projection[0].upperBound).toBeCloseTo(50);
    });
  });

  describe("classifyExpense", () => {
    it("identifies fixed expenses (low variance)", () => {
      const amounts = [100, 100, 100, 100];
      expect(classifyExpense(amounts)).toBe("fixed");
    });

    it("identifies variable expenses (medium variance)", () => {
      const amounts = [100, 120, 90, 110]; // Mean 105, stddev ~12.9, CV ~0.12 (Wait, check logic)
      // SD of [100, 120, 90, 110]:
      // Mean = 105
      // Diffs: -5, 15, -15, 5
      // Sq: 25, 225, 225, 25 = 500
      // Var = 500 / 3 = 166.66
      // SD = 12.9
      // CV = 12.9 / 105 = 0.122 < 0.15 -> Fixed?

      // Let's try more variable
      const moreVariable = [50, 150, 50, 150];
      // Mean 100. SD ~57. CV 0.57 -> Discretionary?

      // Let's try just right for variable
      const variable = [100, 140, 80, 120];
      // Mean 110. Var (100+900+900+100)/3 = 2000/3 = 666. SD 25.8. CV = 0.23 -> Variable
      expect(classifyExpense(variable)).toBe("variable");
    });

    it("identifies discretionary expenses (high variance)", () => {
      const amounts = [10, 200, 0, 50];
      expect(classifyExpense(amounts)).toBe("discretionary");
    });
  });
});
