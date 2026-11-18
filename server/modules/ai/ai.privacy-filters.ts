/**
 * AI Privacy Filters
 *
 * Reusable filter helpers for AI tool queries.
 * Ensures all queries respect:
 * - Soft-delete (deletedAt)
 * - Archive status (isArchived)
 * - Privacy settings (isPrivate, hideTransactions)
 * - Report exclusions (isExcludedFromReports)
 *
 * @module ai/ai.privacy-filters
 */

import { and, eq, isNull, or, sql, SQL } from 'drizzle-orm';
import { transactions, accounts, goals, recurringTransactions } from '@shared/schema';

/**
 * Privacy filters for transaction queries.
 * Requires accounts table to be joined.
 *
 * Filters:
 * - Transaction not soft-deleted
 * - Transaction not excluded from reports
 * - Transaction not private (unless user is owner)
 * - Account not archived
 * - Account not private (unless user is owner)
 * - Account hideTransactions = false
 */
export function transactionPrivacyFilters(
  householdId: string,
  userId?: string
): SQL<unknown>[] {
  const filters: SQL<unknown>[] = [
    // Household isolation
    eq(transactions.householdId, householdId),
    // Soft-delete filter
    isNull(transactions.deletedAt),
    // Report exclusion filter
    eq(transactions.isExcludedFromReports, false),
    sql`NOT EXISTS (
      SELECT 1 FROM transaction_splits
      WHERE transaction_splits.transaction_id = ${transactions.id}
    )`,
  ];

  // Transaction privacy - if private, only owner can see
  if (userId) {
    filters.push(
      or(
        eq(transactions.isPrivate, false),
        eq(transactions.ownerUserId, userId)
      )!
    );
  } else {
    filters.push(eq(transactions.isPrivate, false));
  }

  // Account-level filters (requires JOIN with accounts)
  filters.push(eq(accounts.isArchived, false));

  // Account privacy - if private, only owner can see
  if (userId) {
    filters.push(
      or(
        eq(accounts.isPrivate, false),
        eq(accounts.ownerUserId, userId)
      )!
    );
  } else {
    filters.push(eq(accounts.isPrivate, false));
  }

  // Hide transactions filter
  filters.push(eq(accounts.hideTransactions, false));

  return filters;
}

/**
 * Privacy filters for goal queries.
 *
 * Filters:
 * - Goal not archived
 * - Goal not completed (optional)
 */
export function goalPrivacyFilters(
  householdId: string,
  options: { includeCompleted?: boolean } = {}
): SQL<unknown>[] {
  const filters: SQL<unknown>[] = [
    eq(goals.householdId, householdId),
    eq(goals.isArchived, false),
  ];

  if (!options.includeCompleted) {
    filters.push(eq(goals.isCompleted, false));
  }

  return filters;
}

/**
 * Privacy filters for account queries.
 *
 * Filters:
 * - Account not private (unless user is owner or includePrivate=true)
 * - Account not archived (unless includeArchived=true)
 */
export function accountPrivacyFilters(
  householdId: string,
  options: {
    userId?: string;
    includeArchived?: boolean;
    includePrivate?: boolean;
  } = {}
): SQL<unknown>[] {
  const { userId, includeArchived = false, includePrivate = false } = options;

  const filters: SQL<unknown>[] = [
    eq(accounts.householdId, householdId),
  ];

  // Archive filter
  if (!includeArchived) {
    filters.push(eq(accounts.isArchived, false));
  }

  // Privacy filter
  if (!includePrivate) {
    if (userId) {
      filters.push(
        or(
          eq(accounts.isPrivate, false),
          eq(accounts.ownerUserId, userId)
        )!
      );
    } else {
      filters.push(eq(accounts.isPrivate, false));
    }
  }

  return filters;
}

/**
 * Privacy filters for recurring transaction queries.
 *
 * Filters:
 * - Rule is active
 * - Household isolation
 */
export function recurringPrivacyFilters(householdId: string): SQL<unknown>[] {
  return [
    eq(recurringTransactions.householdId, householdId),
    eq(recurringTransactions.isActive, true),
  ];
}
