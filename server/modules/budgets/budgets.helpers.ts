/**
 * Budget Helpers
 *
 * Money mapping utilities for budget responses.
 *
 * @module modules/budgets/budgets.helpers
 */

import { Money, toMoneyDto } from "../../core/money";
import type { UnbudgetedSpend } from "../../repositories/BudgetUnbudgetedSpend";

export const mapBudgetMoney = <
  T extends {
    amount?: string | number | Money | null;
    rolloverAmount?: string | number | Money | null;
    spent?: string | number | Money;
    remaining?: string | number | Money;
    currency?: string;
  }
>(
  budget: T,
  currency: string = "ZMW"
): T => ({
  ...budget,
  amount:
    budget.amount !== undefined && budget.amount !== null
      ? toMoneyDto(budget.amount, budget.currency ?? currency)
      : budget.amount,
  rolloverAmount:
    budget.rolloverAmount !== undefined && budget.rolloverAmount !== null
      ? toMoneyDto(budget.rolloverAmount, budget.currency ?? currency)
      : budget.rolloverAmount,
  spent:
    budget.spent !== undefined
      ? toMoneyDto(budget.spent, currency)
      : budget.spent,
  remaining:
    budget.remaining !== undefined
      ? toMoneyDto(budget.remaining, currency)
      : budget.remaining,
});

export const mapBudgetPeriodMoney = <T extends { amount?: string | number | null; currency?: string }>(
  period: T,
  currency: string = "ZMW"
): T => ({
  ...period,
  amount:
    period.amount !== undefined && period.amount !== null
      ? toMoneyDto(period.amount, period.currency ?? currency)
      : period.amount,
});

export const mapBudgetWithPeriods = <
  T extends {
    periods?: Array<{ amount?: string | number | null; currency?: string }>;
    currency?: string;
  }
>(
  budget: T,
  currency: string = "ZMW"
): T =>
  ({
    ...mapBudgetMoney(
      budget as unknown as {
        amount?: string | number | null;
        rolloverAmount?: string | number | null;
        currency?: string;
      },
      currency
    ),
    periods: budget.periods
      ? budget.periods.map((p) => mapBudgetPeriodMoney(p, currency))
      : budget.periods,
  } as unknown as T);

/** This month's unbudgeted spending per section as MoneyDto; null where it cannot be reported (N3). */
export const mapUnbudgetedSpend = (spend: UnbudgetedSpend) => ({
  expense: spend.expense ? toMoneyDto(spend.expense, spend.expense.currency) : null,
  income: spend.income ? toMoneyDto(spend.income, spend.income.currency) : null,
});
