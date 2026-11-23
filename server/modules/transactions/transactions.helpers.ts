/**
 * Transaction Controller Helpers
 *
 * Shared mapper functions for transaction data transformation.
 *
 * @module modules/transactions/transactions.helpers
 */

import { amountInUnit } from "../../core/money";
import type { HouseholdContext } from "../../middleware/householdGuard";

/** Mutations keep their raw internal result; external DTOs require a fresh,
 * currently authorized read including coupon custody description projection.
 */
export async function mapVisibleTransactionMoney(id: string, actor: HouseholdContext) {
  const { transactionService } = await import("../../services/TransactionService");
  return mapTransactionMoney(await transactionService.getTransactionById(id, actor.householdId, actor.userId));
}

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
  // FIN-05: the row's own currency, else its account's; never a default ZMW.
  const currency = transaction.currency ?? transaction.accountCurrency ?? null;
  return {
    ...transaction,
    amount:
      transaction.amount !== undefined
        ? amountInUnit(transaction.amount, currency)
        : transaction.amount,
    splits: transaction.splits
      ? transaction.splits.map((split) => ({
          ...split,
          amount:
            split.amount !== undefined
              ? amountInUnit(split.amount, currency)
              : split.amount,
        }))
      : transaction.splits,
  };
};
