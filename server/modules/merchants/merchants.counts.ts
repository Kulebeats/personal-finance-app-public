/**
 * Merchant usage count, derived at read time.
 *
 * merchants.transaction_count was a stored counter that no transaction writer
 * (create, edit, delete, import, rules, bulk) kept up to date, so merchant
 * lists showed stale counts. Each read now counts the merchant's transactions
 * that the caller may see: not deleted, and not another member's private
 * account or private transaction (the shared transaction visibility
 * predicate). Nothing has to be maintained on write, and the count matches
 * GET /merchants/:id/transactions.
 *
 * @module modules/merchants/counts
 */

import { and, eq, getTableColumns, sql, type SQL } from "drizzle-orm";
import { merchants, transactions } from "@shared/schema";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";

/** Correlated COUNT of the outer merchant row's transactions visible to `actor`. */
export function visibleMerchantTransactionCount(actor: HouseholdContext): SQL<number> {
  return sql<number>`(SELECT count(*)::int FROM ${transactions} WHERE ${and(
    eq(transactions.merchantId, merchants.id),
    visibleTransactionPredicate(actor),
  )})`;
}

/** Every merchant column, with transactionCount replaced by the read-time count. */
export function merchantColumnsWithCount(actor: HouseholdContext) {
  return {
    ...getTableColumns(merchants),
    transactionCount: visibleMerchantTransactionCount(actor),
  };
}
