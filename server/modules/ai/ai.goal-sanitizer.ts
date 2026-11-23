/**
 * AI goal sanitizers (AI-DATA-001, C3-08).
 *
 * Strip internal identifiers and personal details from goal tool results before
 * they reach the external AI prompt. Unavailable progress stays null: the
 * sanitizer never turns a withheld figure back into a number.
 *
 * @module ai/ai.goal-sanitizer
 */

import { Money } from '../../core/money';
import type {
  GoalAssignmentResult,
  GoalStatusResult,
  SanitizedGoalAssignmentData,
  SanitizedGoalData,
} from './ai.types';

const MAX_GOALS = 10;
const MAX_PROGRESS_PERCENT = 100;
const FINANCIAL_TERMS = ['Emergency', 'Fund', 'Savings', 'Retirement', 'Investment', 'Vacation', 'House', 'Car', 'Education'];

/**
 * Sanitize goal names to remove personal information.
 * Examples:
 * - "John's Emergency Fund" -> "Emergency Fund"
 * - "Save for Sarah's Birthday" -> "Save for Event"
 */
export function sanitizeGoalName(name: string): string {
  // Remove possessive names
  let sanitized = name.replace(/\b[A-Z][a-z]+'s\s+/g, '');

  // Replace specific personal events with generic terms
  sanitized = sanitized.replace(/\bfor [A-Z][a-z]+('s)?\b/gi, 'for Event');

  // Remove any remaining proper names (simple heuristic), keeping common financial terms
  sanitized = sanitized.replace(/\b[A-Z][a-z]+\b/g, match => (FINANCIAL_TERMS.includes(match) ? match : 'Goal'));

  return sanitized.trim();
}

/** Whole-number progress percentage, capped at 100, computed with Money arithmetic. */
function calculateProgress(current: Money, target: Money): number {
  if (target.isZero()) return 0;
  const percent = current.divide(target.toString()).multiply('100').toNumber();
  return Math.min(Math.round(percent), MAX_PROGRESS_PERCENT);
}

/**
 * Sanitize goal data for AI API.
 * - Limits to 10 goals
 * - Removes goal IDs (internal identifiers)
 * - Converts Money to string
 * - Sanitizes goal names (removes personal details)
 */
export function sanitizeGoalData(data: GoalStatusResult[]): SanitizedGoalData {
  const goals = data.slice(0, MAX_GOALS).map(goal => {
    const name = sanitizeGoalName(goal.name);
    if (goal.progressAvailability === 'unavailable') {
      return {
        name, targetAmount: goal.target?.toString() ?? null,
        currentAmount: null, progressPercent: null, status: null, progressAvailability: 'unavailable' as const,
      };
    }
    return {
      name,
      targetAmount: goal.target.toString(),
      currentAmount: goal.current.toString(),
      progressPercent: calculateProgress(goal.current, goal.target),
      status: goal.status,
      progressAvailability: 'available' as const,
    };
  });

  return { goals };
}

/**
 * Sanitize goal-account assignment data for AI API.
 * - Removes internal goal and account IDs
 * - Sanitizes goal names and generalizes account names
 * - Converts Money to string
 */
export function sanitizeGoalAssignmentData(data: GoalAssignmentResult[]): SanitizedGoalAssignmentData {
  const assignments = data.slice(0, MAX_GOALS).map((assignment, index) => {
    const goalName = sanitizeGoalName(assignment.goalName);
    const target = assignment.target?.toString() ?? null;
    if (assignment.progressAvailability === 'unavailable') {
      return { goalName, accountName: null, target, current: null, progressAvailability: 'unavailable' as const };
    }
    return {
      goalName,
      // Generic name, never the raw account name
      accountName: assignment.accountName ? goalAccountLabel(index) : null,
      target,
      current: assignment.current.toString(),
      progressAvailability: 'available' as const,
    };
  });

  return { assignments };
}

/** The generic label a goal's linked account is sent out under. */
function goalAccountLabel(index: number): string {
  return `account_${index + 1}`;
}

/**
 * Each linked-account label `sanitizeGoalAssignmentData` sends out, paired
 * with the account name it stands for (same limit, same order).
 */
export function goalAccountLabelPairs(data: GoalAssignmentResult[]): Array<readonly [string, string]> {
  return data.slice(0, MAX_GOALS).flatMap((assignment, index) =>
    assignment.progressAvailability !== 'unavailable' && assignment.accountName
      ? [[goalAccountLabel(index), assignment.accountName] as const]
      : [],
  );
}
