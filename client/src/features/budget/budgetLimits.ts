import { subtractMoneyValues, sumMoneyValues } from "@/lib/money";
import type { BudgetCategory, BudgetGroup } from "./types";

/** Missing limits remain absent; zero is an explicitly configured limit. */
export function sumBudgetLimits(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter((value): value is number => value !== null && value !== undefined);
  return present.length ? sumMoneyValues(present).toNumber() : null;
}

export function groupBudgetLimit(group: BudgetGroup): number | null {
  if (group.budget !== undefined || group.isFlexible || group.isGroupBudget) {
    return group.budget ?? null;
  }
  return sumBudgetLimits(group.items.map(item => item.budget));
}

export function remainingBudget(limit: number | null, actual: number | null): number | null {
  return limit === null || actual === null ? null : subtractMoneyValues(limit, actual).toNumber();
}

export function groupActual(group: BudgetGroup): number {
  return group.actual ?? sumMoneyValues(group.items.map(item => item.actual)).toNumber();
}

export function isBudgetedCategory(item: BudgetCategory): boolean {
  return item.budget !== null || item.budgetId !== undefined || item.coverage !== undefined;
}
