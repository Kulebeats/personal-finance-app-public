/**
 * Goals summary totals in the household currency (A-09).
 *
 * Goals keep their own currency: a pay-down goal takes its debt account's, a
 * save-up goal the currency it was created in. A total is therefore stated in
 * the household currency only after converting each goal at the household's
 * latest rate (R12: the household's own rate, else the shared one). A goal
 * whose currency has no rate is left out of every total and counted in
 * `excludedCount`, so the summary says its totals are incomplete instead of
 * adding unlike currencies under one label.
 *
 * @module services/goal/goalSummaryTotals
 */

import type { Goal } from "@shared/schema";
import { getLatestFxRates } from "../../core/calculations";
import { Money } from "../../core/money";

export interface HouseholdGoalTotals {
  /** True when the goal's amounts can be stated in the household currency. */
  isConvertible(goal: Goal): boolean;
  /** How many of `list` are left out of the totals for want of a rate. */
  excludedCount(list: readonly Goal[]): number;
  /** Sum of `pick` over the convertible goals of `list`, in the household currency. */
  sum(list: readonly Goal[], pick: (goal: Goal) => Money): Money;
}

export async function householdGoalTotals(
  goalList: readonly Goal[],
  householdCurrency: string,
  householdId: string,
): Promise<HouseholdGoalTotals> {
  const base = householdCurrency.toUpperCase();
  const currencyOf = (goal: Goal) => (goal.currency || base).toUpperCase();
  const foreign = Array.from(new Set(goalList.map(currencyOf).filter((code) => code !== base)));
  const rates = foreign.length ? await getLatestFxRates(foreign, base, householdId) : new Map<string, number>();
  const rateOf = (goal: Goal) => (currencyOf(goal) === base ? 1 : rates.get(currencyOf(goal)));
  const isConvertible = (goal: Goal) => rateOf(goal) !== undefined;

  return {
    isConvertible,
    excludedCount: (list) => list.filter((goal) => !isConvertible(goal)).length,
    sum: (list, pick) => list.filter(isConvertible).reduce(
      (total, goal) => total.add(new Money(pick(goal).amount.times(rateOf(goal) ?? 0), base)),
      Money.zero(base),
    ),
  };
}
