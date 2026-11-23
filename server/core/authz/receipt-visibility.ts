import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { pendingReceipts, transactions } from "@shared/schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { retainedTransactionPredicate } from "./transaction-visibility";

/**
 * Receipts `actor` may read (Rule 11). A receipt has no privacy of its own:
 * an unlinked receipt is household-visible, and a receipt linked to a
 * transaction takes that transaction's privacy and its account's, so another
 * member's private purchase stays out of every receipt read, lists and totals
 * included.
 */
export function visibleReceiptPredicate(actor: HouseholdContext): SQL {
  return and(
    eq(pendingReceipts.householdId, actor.householdId),
    or(
      isNull(pendingReceipts.matchedTransactionId),
      sql`exists (select 1 from ${transactions} where ${and(
        eq(transactions.id, pendingReceipts.matchedTransactionId), retainedTransactionPredicate(actor),
      )})`,
    ),
  )!;
}
