/**
 * GoalProjectionCalculator Unit Tests
 *
 * Verifies the standalone "what-if" investment growth calculator that backs
 * POST /api/goals/calculate-projection: growth/inflation math (delegated to
 * the existing calculateScenario engine) and the required-monthly-
 * contribution solver added alongside it.
 */

import { describe, it, expect } from "vitest";
import { calculateScenario } from "../../../core/calculations/projections/scenarioAnalysis";
import { toMoney, toPercentage } from "../../../core/calculations/types";
import { calculateGoalProjection } from "../GoalProjectionCalculator";

describe("calculateGoalProjection", () => {
  it("returns null requiredMonthlyContribution when no target is supplied", () => {
    const result = calculateGoalProjection({
      currentAmount: 1000,
      monthlyContribution: 100,
      returnRate: 10,
      inflationRate: 0,
      years: 1,
    });

    expect(result.requiredMonthlyContribution).toBeNull();
  });

  it("matches the underlying scenario engine for projectedAmount and totalContributed", () => {
    const input = {
      currentAmount: 1000,
      monthlyContribution: 100,
      returnRate: 10,
      inflationRate: 5,
      years: 2,
    };

    const result = calculateGoalProjection(input);
    const scenario = calculateScenario({
      initialBalance: toMoney(input.currentAmount),
      monthlyContribution: toMoney(input.monthlyContribution),
      annualReturnRate: toPercentage(input.returnRate),
      years: input.years,
      inflationRate: toPercentage(input.inflationRate),
    });

    expect(result.projectedAmount).toBe(scenario.realEndBalance);
    expect(result.totalContributed).toBe(scenario.totalContributed);
  });

  it("computes a level contribution (0% growth) as a simple average shortfall", () => {
    // No growth: required contribution is just the shortfall spread evenly.
    const result = calculateGoalProjection({
      currentAmount: 1000,
      monthlyContribution: 0,
      returnRate: 0,
      inflationRate: 0,
      years: 1,
      targetAmount: 2200,
    });

    // (2200 - 1000) / 12 = 100
    expect(result.requiredMonthlyContribution).toBeCloseTo(100, 2);
  });

  it("solves a growth-adjusted required contribution that round-trips through the scenario engine", () => {
    const currentAmount = 1000;
    const returnRate = 10;
    const years = 2;
    const targetAmount = 5000;

    const result = calculateGoalProjection({
      currentAmount,
      monthlyContribution: 0, // irrelevant to the target-solve path
      returnRate,
      inflationRate: 0,
      years,
      targetAmount,
    });

    expect(result.requiredMonthlyContribution).not.toBeNull();

    // Plug the solved contribution back into the scenario engine — the
    // resulting nominal end balance should land back on the target. The
    // solved contribution is rounded to the cent, and that rounding error
    // compounds across the annuity (amplified by the annuity factor), so
    // allow a small tolerance rather than exact equality.
    const roundTrip = calculateScenario({
      initialBalance: toMoney(currentAmount),
      monthlyContribution: toMoney(result.requiredMonthlyContribution!),
      annualReturnRate: toPercentage(returnRate),
      years,
      inflationRate: toPercentage(0),
    });

    expect(Math.abs(roundTrip.endBalance - targetAmount)).toBeLessThan(0.5);
  });

  it("clamps an already-exceeded target to a zero required contribution", () => {
    const result = calculateGoalProjection({
      currentAmount: 10000,
      monthlyContribution: 0,
      returnRate: 5,
      inflationRate: 0,
      years: 1,
      targetAmount: 100,
    });

    expect(result.requiredMonthlyContribution).toBe(0);
  });
});
