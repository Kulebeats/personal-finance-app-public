/**
 * Recurring Module - Helpers
 *
 * Money mapping utilities for recurring transaction responses.
 *
 * FIN-05: an amount is labelled only with a currency the server can prove for
 * that row. When the unit is unknown the DTO says so (`currency: null`); it
 * never falls back to ZMW.
 *
 * @module modules/recurring/helpers
 */

import { amountInUnit } from "../../core/money";
import type { RecurringLinkUnits } from "../../services/recurring/RecurringDenomination";

type Amount = string | number;

/**
 * Maps a recurring rule's amount in its proven denomination (`verifiedCurrency`).
 */
export const mapRecurringRuleMoney = <
  T extends { amount?: Amount; verifiedCurrency: string | null },
>(
  rule: T,
): T => ({
  ...rule,
  amount: rule.amount !== undefined ? amountInUnit(rule.amount, rule.verifiedCurrency) : rule.amount,
});

/**
 * Maps amount and splits fields to MoneyDto for transaction responses
 */
export const mapTransactionMoney = <
  T extends {
    amount?: Amount;
    currency?: string | null;
    splits?: Array<{ amount?: Amount }>;
  },
>(
  transaction: T,
): T => ({
  ...transaction,
  amount:
    transaction.amount !== undefined
      ? amountInUnit(transaction.amount, transaction.currency)
      : transaction.amount,
  splits: transaction.splits
    ? transaction.splits.map((split) => ({
        ...split,
        amount:
          split.amount !== undefined
            ? amountInUnit(split.amount, transaction.currency)
            : split.amount,
      }))
    : transaction.splits,
});

/**
 * Maps a link's amounts: the actual amount in the linked transaction's
 * currency, the expected amount in the rule's proven unit. The unit fields are
 * consumed here and not echoed in the response.
 */
export const mapRecurringLinkMoney = <
  T extends {
    expectedAmount?: Amount | null;
    actualAmount?: Amount | null;
  } & RecurringLinkUnits,
>(
  { actualCurrency, expectedCurrency, ...link }: T,
): Omit<T, keyof RecurringLinkUnits> => ({
  ...link,
  expectedAmount:
    link.expectedAmount !== undefined && link.expectedAmount !== null
      ? amountInUnit(link.expectedAmount, expectedCurrency)
      : link.expectedAmount,
  actualAmount:
    link.actualAmount !== undefined && link.actualAmount !== null
      ? amountInUnit(link.actualAmount, actualCurrency)
      : link.actualAmount,
});
