/**
 * Transaction Controller Helpers
 *
 * Shared mapper functions for transaction data transformation.
 *
 * @module modules/transactions/transactions.helpers
 */

import { toMoneyDto } from "../../core/money";

export const mapTransactionMoney = <
  T extends {
    amount?: string | number;
    currency?: string | null;
    accountCurrency?: string | null;
    splits?: Array<{ amount?: string | number }>;
  }
>(
  transaction: T
): T => {
  const currency =
    transaction.currency ?? transaction.accountCurrency ?? undefined;
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

export const mapTransactionLinkMoney = <
  T extends { amount?: string | number; goal?: { currency?: string | null } }
>(
  link: T,
  currency?: string | null
): T => ({
  ...link,
  amount:
    link.amount !== undefined
      ? toMoneyDto(link.amount, link.goal?.currency ?? currency ?? undefined)
      : link.amount,
});
