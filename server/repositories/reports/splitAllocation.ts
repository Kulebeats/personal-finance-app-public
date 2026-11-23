/**
 * Split allocations for report readers (NEW-14).
 *
 * LEFT JOIN `transaction_splits` with `splitAllocationJoin`: an unsplit
 * transaction yields one row (no split), a split one yields one row per split.
 * Read the row's category and amount through the expressions below, so a split
 * purchase counts each split's own category and amount, and the rows of one
 * parent still sum to the parent amount. Visibility, type (income, expense,
 * debt repayment) and FX stay on the parent: a split never changes who may see
 * the transaction or how it counts in the flow rule.
 */
import { eq, sql } from "drizzle-orm";
import { transactions, transactionSplits } from "@shared/schema";

export const splitAllocationJoin = eq(transactionSplits.transactionId, transactions.id);

/** The split's amount, or the parent's when the transaction is not split. */
export const allocationAmount = sql<string>`COALESCE(${transactionSplits.amount}, ${transactions.amount})`;

/** The split's category (null means Uncategorised), or the parent's when not split. */
export const allocationCategoryId = sql<string | null>`(CASE WHEN ${transactionSplits.id} IS NULL THEN ${transactions.categoryId} ELSE ${transactionSplits.categoryId} END)`;

/** A unique, stable row key: the split id, or the parent id when not split. */
export const allocationKey = sql<string>`COALESCE(${transactionSplits.id}, ${transactions.id})`;
