/**
 * Currency for budget writes (C3-10).
 *
 * A budget amount is written in the budget's own currency when it already
 * exists, and in the household currency when it is created. The viewer's
 * display currency is never used: it is a presentation preference and falls
 * back to a default while settings load.
 */

const CURRENCY_CODE = /^[A-Z]{3}$/;

export interface BudgetDenomination {
  id: string;
  currency?: string | null;
  amount?: { currency: string } | null;
}

export function validCurrency(value: string | null | undefined): string | undefined {
  return typeof value === "string" && CURRENCY_CODE.test(value) ? value : undefined;
}

/** The existing budget's own currency, or undefined when it is not known. */
export function budgetCurrency(
  budgets: ReadonlyArray<BudgetDenomination> | undefined,
  budgetId: string,
): string | undefined {
  const budget = budgets?.find((candidate) => candidate.id === budgetId);
  return validCurrency(budget?.currency) ?? validCurrency(budget?.amount?.currency);
}

export const CURRENCY_UNKNOWN_MESSAGE = {
  existing: "This budget's currency is not available yet. Reload the page and try again.",
  create: "The household currency is still loading. Try again in a moment.",
} as const;
