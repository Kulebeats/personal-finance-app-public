/**
 * Calculation Engine - Scenario Analysis
 *
 * Provides compound interest and investment growth projections
 * allowing for variable rates and contributions (Monte Carlo styled inputs).
 *
 * @module core/calculations/projections/scenarioAnalysis
 */

import { Money, Percentage, toMoney } from "../types";
import { roundToDecimals } from "../helpers";

export interface ScenarioInput {
  initialBalance: Money;
  monthlyContribution: Money;
  annualReturnRate: Percentage;
  years: number;
  inflationRate?: Percentage;
}

export interface ScenarioResult {
  endBalance: Money;
  totalContributed: Money;
  totalInterest: Money;
  realEndBalance: Money; // Adjusted for inflation
  yearlyBreakdown: {
    year: number;
    balance: Money;
    contributed: Money;
    interest: Money;
    realBalance: Money;
  }[];
}

/**
 * Calculates investment growth scenario.
 *
 * @param input - Scenario parameters
 * @returns Detailed projection result
 */
export function calculateScenario(input: ScenarioInput): ScenarioResult {
  const {
    initialBalance,
    monthlyContribution,
    annualReturnRate,
    years,
    inflationRate = 0,
  } = input;

  let balance = initialBalance as number;
  let totalContributed = initialBalance as number;
  let totalInterest = 0;
  const yearlyBreakdown = [];

  const monthlyRate = annualReturnRate / 100 / 12;

  // We actually calculate real balance by discounting the nominal balance
  // Formula: Real = Nominal / (1 + inflation)^years

  for (let year = 1; year <= years; year++) {
    let yearInterest = 0;
    let yearContribution = 0;

    for (let month = 1; month <= 12; month++) {
      const interest = balance * monthlyRate;
      balance += interest + monthlyContribution;

      yearInterest += interest;
      yearContribution += monthlyContribution;
      totalInterest += interest;
      totalContributed += monthlyContribution;
    }

    const inflationFactor = Math.pow(1 + inflationRate / 100, year);
    const realBalance = balance / inflationFactor;

    yearlyBreakdown.push({
      year,
      balance: toMoney(roundToDecimals(balance)),
      contributed: toMoney(roundToDecimals(totalContributed)),
      interest: toMoney(roundToDecimals(totalInterest)),
      realBalance: toMoney(roundToDecimals(realBalance)),
    });
  }

  const finalInflationFactor = Math.pow(1 + inflationRate / 100, years);
  const realEndBalance = toMoney(
    roundToDecimals(balance / finalInflationFactor)
  );

  return {
    endBalance: toMoney(roundToDecimals(balance)),
    totalContributed: toMoney(roundToDecimals(totalContributed)),
    totalInterest: toMoney(roundToDecimals(totalInterest)),
    realEndBalance,
    yearlyBreakdown,
  };
}
