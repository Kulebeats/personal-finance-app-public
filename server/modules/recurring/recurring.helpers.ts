/**
 * Recurring Module - Helpers
 *
 * Money mapping utilities for recurring transaction responses.
 *
 * @module modules/recurring/helpers
 */

import { toMoneyDto } from "../../core/money";

/**
 * Maps amount field to MoneyDto for recurring rule responses
 */
export const mapRecurringRuleMoney = <T extends { amount?: string | number }>(
  rule: T,
): T => ({
  ...rule,
  amount: rule.amount !== undefined ? toMoneyDto(rule.amount) : rule.amount,
});

/**
 * Maps amount and splits fields to MoneyDto for transaction responses
 */
export const mapTransactionMoney = <
  T extends {
    amount?: string | number;
    currency?: string | null;
    splits?: Array<{ amount?: string | number }>;
  },
>(
  transaction: T,
): T => {
  const currency = transaction.currency ?? undefined;
  return {
    ...transaction,
    amount:
      transaction.amount !== undefined
        ? toMoneyDto(transaction.amount, currency)
        : transaction.amount,
    splits: transaction.splits
      ? transaction.splits.map((split) => ({
          ...split,
          amount:
            split.amount !== undefined
              ? toMoneyDto(split.amount, currency)
              : split.amount,
        }))
      : transaction.splits,
  };
};

/**
 * Maps expectedAmount and actualAmount fields to MoneyDto for recurring link responses
 */
export const mapRecurringLinkMoney = <
  T extends {
    expectedAmount?: string | number | null;
    actualAmount?: string | number | null;
  },
>(
  link: T,
): T => ({
  ...link,
  expectedAmount:
    link.expectedAmount !== undefined && link.expectedAmount !== null
      ? toMoneyDto(link.expectedAmount)
      : link.expectedAmount,
  actualAmount:
    link.actualAmount !== undefined && link.actualAmount !== null
      ? toMoneyDto(link.actualAmount)
      : link.actualAmount,
});
