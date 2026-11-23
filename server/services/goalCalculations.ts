import type { Goal } from "@shared/schema";
import {
  calculateGoalProgress,
  calculatePercentComplete as engineCalculatePercent,
  determineGoalStatus,
  toMoney,
} from "../core/calculations";
import { Money } from "../core/money";
import { projectedCompletionDate, requiredMonthlyContribution } from "./goal/goalForecast";

export type GoalStatus = "on_track" | "behind" | "at_risk" | "completed";

export function getGoalTargetAmount(goal: Goal): number {
  if (goal.type === "pay_down") {
    const original = goal.originalBalance
      ? new Money(goal.originalBalance).toNumber()
      : new Money(goal.targetAmount).toNumber();
    return Math.max(0, original);
  }

  const val = new Money(goal.targetAmount).toNumber();
  return Number.isFinite(val) ? Math.max(0, val) : 0;
}

/**
 * Returns goal target as Money (preserves precision for calculations)
 * FIX: DATA-MONEY-CROSS-001 - Use this instead of getGoalTargetAmount for calculations
 */
export function getGoalTargetAmountMoney(goal: Goal): Money {
  if (goal.type === "pay_down") {
    const original = goal.originalBalance
      ? new Money(goal.originalBalance)
      : new Money(goal.targetAmount);
    return original.isNegative() ? Money.zero() : original;
  }

  return new Money(goal.targetAmount);
}

export function getGoalCurrentAmount(
  goal: Goal,
  currentOverride?: number
): number {
  if (currentOverride !== undefined) return currentOverride;
  const val = new Money(goal.currentAmount).toNumber();
  return Number.isFinite(val) ? Math.max(0, val) : 0;
}

/**
 * Returns goal current amount as Money (preserves precision for calculations)
 * FIX: DATA-MONEY-CROSS-001 - Use this instead of getGoalCurrentAmount for calculations
 */
export function getGoalCurrentAmountMoney(
  goal: Goal,
  currentOverride?: Money
): Money {
  if (currentOverride !== undefined) return currentOverride;
  return new Money(goal.currentAmount);
}

export function getGoalProgressAmount(
  goal: Goal,
  currentOverride?: number
): number {
  const current = getGoalCurrentAmount(goal, currentOverride);
  const target = getGoalTargetAmount(goal);

  if (goal.type === "pay_down") {
    return Math.max(0, target - current); // Progress is amount paid off (original - current debt)
  }

  // For standard goals, cap progress at target
  return Math.min(target, current);
}

/**
 * Returns goal progress amount as Money (preserves precision for calculations)
 * FIX: DATA-MONEY-CROSS-001 - Use this instead of getGoalProgressAmount for calculations
 */
export function getGoalProgressAmountMoney(
  goal: Goal,
  currentOverride?: Money
): Money {
  const current = getGoalCurrentAmountMoney(goal, currentOverride);
  const target = getGoalTargetAmountMoney(goal);

  if (goal.type === "pay_down") {
    // Progress is amount paid off (original - current debt)
    const progress = target.subtract(current);
    return progress.isNegative() ? Money.zero() : progress;
  }

  // For standard goals, cap progress at target
  return current.gt(target) ? target : current;
}

export function calculatePercentComplete(
  goal: Goal,
  currentOverride?: number
): number {
  const current = getGoalCurrentAmount(goal, currentOverride);
  const target = getGoalTargetAmount(goal);

  if (goal.type === "pay_down") {
    // Pay down logic: (original - current) / original * 100
    // Current is remaining debt. Target is original debt.
    // Progress = target - current.
    const progress = Math.max(0, target - current);
    return engineCalculatePercent(toMoney(progress), toMoney(target));
  }

  return engineCalculatePercent(toMoney(current), toMoney(target));
}

export function calculateStatus(
  goal: Goal,
  currentOverride: number | undefined,
  /** The household's calendar date (householdToday); required so status never runs on the UTC day. */
  today: string
): GoalStatus {
  if (goal.isCompleted) return "completed";

  const current = getGoalCurrentAmount(goal, currentOverride);
  const target = getGoalTargetAmount(goal);

  // Paydown goals: progress is amount paid off
  const effectiveCurrent =
    goal.type === "pay_down" ? Math.max(0, target - current) : current;

  // For status calculation, engine expects standard "progress" semantics
  const statusResult = determineGoalStatus({
    currentAmount: toMoney(effectiveCurrent),
    targetAmount: toMoney(target),
    startDate: new Date(goal.startDate).toISOString().split("T")[0],
    targetDate: goal.targetDate
      ? new Date(goal.targetDate).toISOString().split("T")[0]
      : today, // An undated goal is judged against today
    currentDate: today,
  });

  // Map engine status to local GoalStatus
  switch (statusResult.status) {
    case "completed":
      return "completed";
    case "on_track":
      return "on_track";
    case "behind":
      return "behind";
    case "at_risk":
      return "at_risk";
    case "overdue":
      return "at_risk"; // Map overdue to at_risk
    case "not_started":
      return "on_track"; // Optimistic default or map to on_track? Existing logic returns on_track if !targetDate.
    default:
      return "on_track";
  }
}

/**
 * What a save-up or investment goal still needs, in the goal's currency.
 * Progress below zero counts as none (as the number helpers above clamp it).
 */
function remainingToTarget(goal: Goal, currentOverride?: Money): Money {
  const target = new Money(goal.targetAmount, goal.currency);
  const current = new Money((currentOverride ?? new Money(goal.currentAmount)).amount, goal.currency);
  return target.subtract(current.isNegative() ? Money.zero(goal.currency) : current);
}

/**
 * NEW-15: the monthly amount that reaches the target by its date, counted in
 * calendar months from `today`, the household's calendar date. Null for a
 * pay-down goal or one with no target date; zero once the target is reached.
 */
export function calculateMonthlyProjection(
  goal: Goal,
  today: string,
  currentOverride?: Money
): Money | null {
  if (goal.type === "pay_down") return null;
  if (!goal.targetDate) return null;
  const remaining = remainingToTarget(goal, currentOverride);
  if (remaining.isNegativeOrZero()) return Money.zero(goal.currency);
  return requiredMonthlyContribution(remaining, today, goal.targetDate);
}

/**
 * NEW-15: the date the goal completes at `monthlyContribution` (by default the
 * monthly projection), in calendar months from `today`, the household's
 * calendar date. Null when nothing is being added.
 */
export function calculateProjectedCompletion(
  goal: Goal,
  today: string,
  monthlyContribution?: Money | null,
  currentOverride?: Money
): string | null {
  if (goal.type === "pay_down") return null;
  const remaining = remainingToTarget(goal, currentOverride);
  if (remaining.isNegativeOrZero()) return today;
  const monthly = monthlyContribution ?? calculateMonthlyProjection(goal, today, currentOverride);
  return monthly ? projectedCompletionDate(remaining, monthly, today) : null;
}

/**
 * The progress fields a balance change saves. `today` is the household's
 * calendar date (householdToday). It is required, so no caller can fall back
 * to the host's or UTC's date.
 */
export function buildGoalBalanceUpdate(
  goal: Goal,
  newBalance: Money | number,
  today: string
): {
  currentAmount: string;
  status: GoalStatus;
  monthlyProjection: string | null;
  projectedCompletionDate: string | null;
  isCompleted: boolean;
  completedAt: Date | null;
} {
  // Convert to Money if needed (preserves precision)
  const balanceMoney = newBalance instanceof Money
    ? newBalance
    : new Money(String(newBalance));

  // For status/projection calculations, we need numbers (logic-only, not persistence)
  const balanceNumber = balanceMoney.toNumber();

  const status = calculateStatus(goal, balanceNumber, today);
  const monthlyProjection = calculateMonthlyProjection(goal, today, balanceMoney);
  const projectedCompletionDate = calculateProjectedCompletion(goal, today, monthlyProjection, balanceMoney);
  const percentComplete = calculatePercentComplete(goal, balanceNumber);
  const isCompleted = percentComplete >= 100;

  return {
    // CRITICAL: Use Money.toString() for precision, not toFixed(2)
    currentAmount: balanceMoney.toString(),
    status,
    monthlyProjection: monthlyProjection === null ? null : monthlyProjection.toString(),
    projectedCompletionDate,
    isCompleted,
    completedAt:
      isCompleted && !goal.isCompleted ? new Date() : goal.completedAt,
  };
}
