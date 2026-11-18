import { describe, it, expect } from "vitest";
import {
  calculateLinearForecast,
  forecastFutureValues,
} from "../linearForecast";
import { calculateScenario } from "../scenarioAnalysis";
import { toMoney, toPercentage } from "../../types";

describe("Linear Forecast", () => {
  it("calculates slope and intercept correctly", () => {
    // y = 2x + 1
    const data = [
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
    ];
    const result = calculateLinearForecast(data);
    expect(result.slope).toBe(2);
    expect(result.intercept).toBe(1);
    expect(result.rSquared).toBe(1);
    expect(result.predict(4)).toBe(9);
  });

  it("forecasts future values", () => {
    // 10, 20, 30 -> Next 2 should be 40, 50
    const historical = [10, 20, 30];
    const forecast = forecastFutureValues(historical, 2);
    expect(forecast).toEqual([40, 50]);
  });
});

describe("Scenario Analysis", () => {
  it("calculates compound interest correctly", () => {
    const input = {
      initialBalance: toMoney(1000),
      monthlyContribution: toMoney(100),
      annualReturnRate: toPercentage(10),
      years: 1,
      inflationRate: toPercentage(0),
    };

    const result = calculateScenario(input);

    // Approx check:
    // Principal: 1000
    // Contrib: 1200
    // Interest on principal: 1000 * 10% = 100 (roughly)
    // Interest on contrib: 100 * 6.5 (roughly half year avg) * 10% / 12 ...
    // totalContributed = initialBalance (1000) + 12 months × 100 = 2200
    expect(result.totalContributed).toBe(2200);
    expect(result.endBalance).toBeGreaterThan(2200);
    expect(result.yearlyBreakdown).toHaveLength(1);
  });
});
