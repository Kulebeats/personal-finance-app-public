/**
 * Goal Projection Calculator
 *
 * Standalone "what-if" investment growth calculator for arbitrary
 * user-entered inputs (current savings, monthly contribution, expected
 * return, inflation, time horizon) — NOT tied to a saved goal record.
 *
 * Growth + inflation-adjustment math delegates to the existing, tested
 * compound-interest engine in core/calculations/projections. The
 * required-monthly-contribution figure (which that engine does not
 * provide) is solved here with decimal.js to avoid float drift.
 *
 * Precision note: like DebtPayoffCalculator / GoalDebtService.calculatePayoff,
 * this produces a projection/estimate, not a ledger write — see
 * GoalDebtService's class doc comment for the boundary-conversion rationale.
 *
 * @module services/goal/GoalProjectionCalculator
 */

import Decimal from "decimal.js";
import { calculateScenario } from "../../core/calculations/projections/scenarioAnalysis";
import { toMoney, toPercentage } from "../../core/calculations/types";

export interface GoalProjectionCalculatorInput {
  currentAmount: number;
  monthlyContribution: number;
  returnRate: number; // annual %, e.g. 12 for 12%
  inflationRate: number; // annual %, e.g. 5 for 5%
  years: number;
  targetAmount?: number;
}

export interface GoalProjectionCalculatorResult {
  /** Inflation-adjusted (real) projected balance at the end of the horizon. */
  projectedAmount: number;
  /** Sum of the starting balance plus every monthly contribution made. */
  totalContributed: number;
  /**
   * Monthly contribution needed to reach `targetAmount` (nominal) by the
   * end of the horizon, given the projection's other inputs.
   * `null` when no targetAmount was supplied.
   */
  requiredMonthlyContribution: number | null;
}

/**
 * Runs the growth projection and, when a target is supplied, the required
 * monthly contribution to reach it.
 */
export function calculateGoalProjection(
  input: GoalProjectionCalculatorInput
): GoalProjectionCalculatorResult {
  const scenario = calculateScenario({
    initialBalance: toMoney(input.currentAmount),
    monthlyContribution: toMoney(input.monthlyContribution),
    annualReturnRate: toPercentage(input.returnRate),
    years: input.years,
    inflationRate: toPercentage(input.inflationRate),
  });

  return {
    projectedAmount: scenario.realEndBalance,
    totalContributed: scenario.totalContributed,
    requiredMonthlyContribution:
      input.targetAmount === undefined
        ? null
        : solveRequiredMonthlyContribution(
            input.currentAmount,
            input.returnRate,
            input.years,
            input.targetAmount
          ),
  };
}

/**
 * Solves the ordinary-annuity future-value formula for the level monthly
 * contribution needed to reach `target` (nominal) after `years` of monthly
 * compounding at `annualRatePercent`, starting from `principal`:
 *
 *   FV = principal * (1+i)^n + contribution * (((1+i)^n - 1) / i)
 *
 * where i is the monthly rate and n the number of months. This mirrors the
 * end-of-month contribution convention used by calculateScenario() (grow,
 * then add that month's contribution). Uses decimal.js throughout rather
 * than plain JS numbers to avoid float drift across up to 600 months.
 */
function solveRequiredMonthlyContribution(
  principal: number,
  annualRatePercent: number,
  years: number,
  target: number
): number {
  const months = years * 12;
  const monthlyGrowth = new Decimal(annualRatePercent)
    .dividedBy(100)
    .dividedBy(12);
  const principalDecimal = new Decimal(principal);
  const targetDecimal = new Decimal(target);

  if (monthlyGrowth.isZero()) {
    const level = targetDecimal.minus(principalDecimal).dividedBy(months);
    return clampToNonNegativeCents(level);
  }

  const growthFactor = new Decimal(1).plus(monthlyGrowth).pow(months);
  const futureValueOfPrincipal = principalDecimal.times(growthFactor);
  const annuityFactor = growthFactor.minus(1).dividedBy(monthlyGrowth);

  const contribution = targetDecimal
    .minus(futureValueOfPrincipal)
    .dividedBy(annuityFactor);

  return clampToNonNegativeCents(contribution);
}

function clampToNonNegativeCents(value: Decimal): number {
  if (value.isNegative()) return 0;
  return value.toDecimalPlaces(2).toNumber();
}
