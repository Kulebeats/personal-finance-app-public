import type { Goal } from "@shared/schema";
import {
  calculateGoalProgress,
  calculatePercentComplete as engineCalculatePercent,
  determineGoalStatus,
  calculateGoalProjection,
  calculateRequiredMonthlyContribution,
  toMoney,
} from "../core/calculations";
import { Money } from "../core/money";

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
  currentOverride?: number
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
      : new Date().toISOString().split("T")[0], // Default to today if no target date to avoid errors, though logic handles it
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

export function calculateMonthlyProjection(
  goal: Goal,
  currentOverride?: number
): number | null {
  if (goal.type === "pay_down") return null;
  if (!goal.targetDate) return null;

  const current = getGoalCurrentAmount(goal, currentOverride);
  const target = getGoalTargetAmount(goal);

  if (current >= target) return 0;

  const targetDate = new Date(goal.targetDate);
  const today = new Date();

  // Engine helper for required monthly contribution
  const monthsRemaining =
    (targetDate.getFullYear() - today.getFullYear()) * 12 +
    (targetDate.getMonth() - today.getMonth());

  const effectiveMonths = Math.max(1, monthsRemaining);
  const remaining = Math.max(0, target - current);

  const required = calculateRequiredMonthlyContribution(
    toMoney(remaining),
    effectiveMonths
  );
  return required;
}

export function calculateProjectedCompletion(
  goal: Goal,
  monthlyContribution?: number,
  currentOverride?: number
): string | null {
  if (goal.type === "pay_down") return null;

  const current = getGoalCurrentAmount(goal, currentOverride);
  const target = getGoalTargetAmount(goal);
  const targetDate = goal.targetDate
    ? new Date(goal.targetDate).toISOString().split("T")[0]
    : "";

  if (current >= target) return new Date().toISOString().split("T")[0];

  const monthly =
    monthlyContribution ?? calculateMonthlyProjection(goal, currentOverride);
  if (!monthly || monthly <= 0) return null;

  // Use engine projection with synthetic inputs to get date
  // We construct a "recentContributions" input based on the monthly rate provided
  // rate = recent / period. We want rate = monthly / 30 * period?
  // Engine: dailyRate = recent / period.
  // We want: dailyRate = monthly / 30.
  // So let recent = monthly, period = 30.

  const projection = calculateGoalProjection({
    currentAmount: toMoney(current),
    targetAmount: toMoney(target),
    targetDate: targetDate || new Date().toISOString().split("T")[0], // Dummy date if missing, just need rate projection
    recentContributions: toMoney(monthly),
    contributionPeriodDays: 30,
  });

  return projection.projectedCompletionDate === "never"
    ? null
    : projection.projectedCompletionDate;
}

export function buildGoalBalanceUpdate(
  goal: Goal,
  newBalance: Money | number
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

  const status = calculateStatus(goal, balanceNumber);
  const monthlyProjection = calculateMonthlyProjection(goal, balanceNumber);
  const projectedCompletionDate = calculateProjectedCompletion(
    goal,
    monthlyProjection ?? undefined,
    balanceNumber
  );
  const percentComplete = calculatePercentComplete(goal, balanceNumber);
  const isCompleted = percentComplete >= 100;

  return {
    // CRITICAL: Use Money.toString() for precision, not toFixed(2)
    currentAmount: balanceMoney.toString(),
    status,
    monthlyProjection:
      monthlyProjection === null ? null : new Money(String(monthlyProjection)).toString(),
    projectedCompletionDate,
    isCompleted,
    completedAt:
      isCompleted && !goal.isCompleted ? new Date() : goal.completedAt,
  };
}
