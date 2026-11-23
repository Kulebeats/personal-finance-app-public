/**
 * Recurring skip, pause/resume and end-date semantics (R14), in one place.
 *
 * - Skip moves nextDueDate on by exactly one period of the rule (calendar
 *   arithmetic on YYYY-MM-DD dates, so no zone can shift it). It posts
 *   nothing. A skip may name the occurrence it skips (`occurrenceDate`):
 *   repeating a skip for an occurrence that is already behind the rule is an
 *   idempotent no-op (no write, no history, no audit row), and naming an
 *   occurrence past the next one is refused. A skip without a date skips the
 *   current next occurrence.
 * - Pause stops posting, upcoming and the cash-flow forecast. Resume never
 *   back-posts: it moves nextDueDate to the first occurrence on or after the
 *   household's today, so occurrences missed while paused are dropped.
 * - The end date is INCLUSIVE: an occurrence on endDate still posts and
 *   projects, nothing after it does. Once endDate has passed, or the next
 *   occurrence falls after it, the rule has ended: processing marks it
 *   inactive, and the list, upcoming and the forecast no longer treat it as
 *   active.
 *
 * @module services/recurring/RecurringLifecycleRules
 */

import type { RecurringTransaction } from "@shared/schema";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { ConflictError } from "../../utils/errorHandler";

/** Bounds a roll-forward so a corrupt rule cannot loop; a daily rule needs ~27 years to reach it. */
const MAX_ROLL_FORWARD_STEPS = 10_000;

/** The first occurrence on or after `today`, stepping the rule's own period. */
export function firstOccurrenceOnOrAfter(rule: RecurringTransaction, today: string): string {
  let next = rule.nextDueDate;
  for (let step = 0; next < today && step < MAX_ROLL_FORWARD_STEPS; step++) {
    const after = recurringRepository.nextDateAfter({ ...rule, nextDueDate: next });
    if (after <= next) break;
    next = after;
  }
  return next;
}

/** "noop" when the named occurrence is already behind the rule (skipped or posted). */
export function skipOutcome(rule: RecurringTransaction, occurrenceDate: string | undefined): "skip" | "noop" {
  if (occurrenceDate === undefined || occurrenceDate === rule.nextDueDate) return "skip";
  if (occurrenceDate < rule.nextDueDate) return "noop";
  throw new ConflictError("Only the next occurrence can be skipped");
}

/** The next occurrence would fall after the inclusive end date. */
export function isPastEnd(endDate: string | null, nextDueDate: string): boolean {
  return endDate !== null && nextDueDate > endDate;
}
