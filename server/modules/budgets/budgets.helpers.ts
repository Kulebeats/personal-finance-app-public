/**
 * Budget Helpers
 *
 * Money mapping utilities for budget responses.
 *
 * @module modules/budgets/budgets.helpers
 */

import { Money, toMoneyDto } from "../../core/money";

export const mapBudgetMoney = <
  T extends {
    amount?: string | number | Money;
    rolloverAmount?: string | number | Money | null;
    spent?: string | number | Money;
    remaining?: string | number | Money;
  }
>(
  budget: T,
  currency: string = "ZMW"
): T => ({
  ...budget,
  amount:
    budget.amount !== undefined
      ? toMoneyDto(budget.amount, currency)
      : budget.amount,
  rolloverAmount:
    budget.rolloverAmount !== undefined && budget.rolloverAmount !== null
      ? toMoneyDto(budget.rolloverAmount, currency)
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

export const mapBudgetPeriodMoney = <T extends { amount?: string | number }>(
  period: T,
  currency: string = "ZMW"
): T => ({
  ...period,
  amount:
    period.amount !== undefined
      ? toMoneyDto(period.amount, currency)
      : period.amount,
});

export const mapBudgetWithPeriods = <
  T extends {
    periods?: Array<{ amount?: string | number }>;
  }
>(
  budget: T,
  currency: string = "ZMW"
): T =>
  ({
    ...mapBudgetMoney(
      budget as unknown as {
        amount?: string | number;
        rolloverAmount?: string | number | null;
      },
      currency
    ),
    periods: budget.periods
      ? budget.periods.map((p) => mapBudgetPeriodMoney(p, currency))
      : budget.periods,
  } as unknown as T);
