/**
 * Calculation Engine - Goal Status Determination
 *
 * Determines the status of a goal based on progress and deadline.
 *
 * @module core/calculations/goals/status
 */

import { Money, Percentage, toPercentage } from "../types";
import { roundToDecimals } from "../helpers";

/**
 * Goal status categories.
 */
export type GoalStatus =
  | "not_started"
  | "on_track"
  | "behind"
  | "at_risk"
  | "completed"
  | "overdue";

/**
 * Goal status result with details.
 */
export interface GoalStatusResult {
  /** Current status */
  status: GoalStatus;
  /** Percentage on track (100 = exactly on track) */
  onTrackPercentage: Percentage;
  /** Expected amount by now based on deadline */
  expectedAmount: Money;
  /** Actual vs expected variance (positive = ahead) */
  variance: Money;
  /** Human-readable message */
  message: string;
}

/**
 * Goal information for status calculation.
 */
export interface GoalInfo {
  currentAmount: Money;
  targetAmount: Money;
  startDate: string;
  targetDate: string;
  currentDate?: string;
}

/**
 * Determines goal status based on current progress vs expected progress.
 *
 * @param goal - Goal information
 * @returns Status result with details
 *
 * @example
 * ```ts
 * const status = determineGoalStatus({
 *   currentAmount: toMoney(5000),
 *   targetAmount: toMoney(10000),
 *   startDate: '2025-01-01',
 *   targetDate: '2025-12-31',
 * });
 * ```
 */
export function determineGoalStatus(goal: GoalInfo): GoalStatusResult {
  const { currentAmount, targetAmount, startDate, targetDate } = goal;
  const currentDate =
    goal.currentDate ?? new Date().toISOString().split("T")[0];

  const start = new Date(startDate);
  const target = new Date(targetDate);
  const current = new Date(currentDate);

  // Check if completed
  if (currentAmount >= targetAmount && targetAmount > 0) {
    return {
      status: "completed",
      onTrackPercentage: toPercentage(100),
      expectedAmount: targetAmount,
      variance: (currentAmount - targetAmount) as Money,
      message: "Goal completed!",
    };
  }

  // Check if overdue
  if (current > target) {
    return {
      status: "overdue",
      onTrackPercentage: toPercentage(
        roundToDecimals((currentAmount / targetAmount) * 100, 2)
      ),
      expectedAmount: targetAmount,
      variance: (currentAmount - targetAmount) as Money,
      message: `Overdue - need ${formatMoney(
        targetAmount - currentAmount
      )} more`,
    };
  }

  // Check if not started — only BEFORE the start date. On or after the start
  // date the goal is "in progress" and is judged against expected pace below
  // (SCP-337: a goal sitting exactly on its start date is on_track, not
  // not_started — nothing is expected yet).
  if (currentAmount === 0 && current < start) {
    return {
      status: "not_started",
      onTrackPercentage: toPercentage(0),
      expectedAmount: 0 as Money,
      variance: 0 as Money,
      message: "Goal not started yet",
    };
  }

  // Calculate expected progress
  const totalDays = Math.max(1, daysBetween(start, target));
  const elapsedDays = Math.max(0, daysBetween(start, current));
  const progressRatio = elapsedDays / totalDays;

  const expectedAmount = (targetAmount * progressRatio) as Money;
  const variance = (currentAmount - expectedAmount) as Money;
  // Field value only: how much of the expected amount you've hit. When nothing
  // is expected yet (start of the goal) you are, by definition, fully on track.
  const onTrackPercentage =
    expectedAmount > 0
      ? roundToDecimals((currentAmount / expectedAmount) * 100, 2)
      : 100;

  // SCP-337: classify by how far BEHIND SCHEDULE you are relative to the TARGET,
  // not by current/expected. Early in a goal's life expectedAmount ≈ 0, so
  // current/expected is unstable and wrongly flagged a barely-started goal as
  // at_risk. shortfallRatio = (expected - current) / target is 0 at the start
  // and grows only as you genuinely fall behind the required pace.
  const shortfallRatio =
    targetAmount > 0 ? (expectedAmount - currentAmount) / targetAmount : 0;

  if (shortfallRatio <= 0.05) {
    return {
      status: "on_track",
      onTrackPercentage: toPercentage(onTrackPercentage),
      expectedAmount,
      variance,
      message: "On track to meet goal",
    };
  } else if (shortfallRatio <= 0.25) {
    return {
      status: "behind",
      onTrackPercentage: toPercentage(onTrackPercentage),
      expectedAmount,
      variance,
      message: `Slightly behind - expected ${formatMoney(expectedAmount)}`,
    };
  } else {
    return {
      status: "at_risk",
      onTrackPercentage: toPercentage(onTrackPercentage),
      expectedAmount,
      variance,
      message: `At risk - need to increase contributions`,
    };
  }
}

/**
 * Helper to calculate days between two dates.
 */
function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay);
}

/**
 * Simple money formatter (can be enhanced).
 */
function formatMoney(amount: Money | number): string {
  return Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
