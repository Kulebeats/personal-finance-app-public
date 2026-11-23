/**
 * Calculation Engine - Recurring Projections
 *
 * Logic for projecting future occurrences of recurring rules.
 */

import { Money, toMoney } from "../types";
import { RecurringRuleInfo } from "./types";
import { calculateNextDate } from "./dates";

export interface ProjectedOccurrence<A = Money> {
  date: string;
  amount: A;
  ruleId?: string;
}

/**
 * Projects future occurrences of a recurring rule within a date range.
 *
 * @param rule - The recurring rule information
 * @param endDate - Projection end date (inclusive)
 * @param startDate - Projection start date (default: today or rule.nextDueDate)
 * @returns List of projected occurrences
 */
export function projectOccurrences<A = Money>(
  rule: RecurringRuleInfo<A>,
  endDate: string,
  startDate?: string
): ProjectedOccurrence<A>[] {
  const occurrences: ProjectedOccurrence<A>[] = [];

  if (!rule.nextDueDate) return occurrences;
  // R14: the end date is inclusive; the first occurrence must not fall after it either.
  if (rule.endDate && (rule.endDate < (startDate || rule.nextDueDate) || rule.nextDueDate > rule.endDate))
    return occurrences;

  let currentLinkDate =
    startDate && startDate > rule.nextDueDate ? startDate : rule.nextDueDate;

  // If startDate provided and is after rule's next due date, we need to advance logic to find first occurrence >= startDate
  // This is expensive if gap is huge. For now, assume we start from nextDueDate and filter.
  // Actually, let's just generate from nextDueDate until endDate, then filter >= startDate.

  let iteratorDate = rule.nextDueDate;

  // Safety: prevent infinite loops if date doesn't advance
  let safetyCounter = 0;
  const MAX_ITERATIONS = 1000;

  while (iteratorDate <= endDate && safetyCounter < MAX_ITERATIONS) {
    if (iteratorDate >= (startDate || "")) {
      occurrences.push({
        date: iteratorDate,
        amount: rule.amount,
        ruleId: rule.id,
      });
    }

    const prevDate = iteratorDate;
    iteratorDate = calculateNextDate(iteratorDate, rule.frequency, {
      dayOfMonth: rule.dayOfMonth ?? undefined,
      dayOfWeek: rule.dayOfWeek ?? undefined,
      intervalValue: rule.intervalValue,
      intervalUnit: rule.intervalUnit,
    });

    if (iteratorDate <= prevDate) break; // Should not happen with valid logic, but safety first

    if (rule.endDate && iteratorDate > rule.endDate) break;

    safetyCounter++;
  }

  return occurrences;
}
