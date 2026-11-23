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

import { eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { transactions, accounts, goals, recurringTransactions } from '@shared/schema';
import { ForbiddenError } from '../../core/errors';
import { can } from '../../core/authz/capabilities';
import { visibleAccountPredicate } from '../../core/authz/transaction-visibility';
import type { HouseholdContext } from '../../middleware/householdGuard';
import type { QueryContext } from './ai.types';

/**
 * The signed caller every source-scoped AI reader is bound to. Fails closed when
 * the resolved household context is missing, belongs to another caller or
 * household, or lacks financial read access.
 */
export function requireFinancialReadActor(context: QueryContext): HouseholdContext {
  const actor = context.actor;
  if (!actor || actor.userId !== context.userId || actor.householdId !== context.householdId ||
      !can(actor.role, 'financial.read')) {
    throw new ForbiddenError('AI financial access requires the current caller context');
  }
  return actor;
}

/**
 * Privacy filters for transaction queries.
 * Requires the source account join and the resolved signed reader.
 *
 * Filters:
 * - Current financial-read membership; source account in the same household,
 *   not soft-deleted, and not private unless the reader owns it
 * - Transaction not soft-deleted, not excluded from reports, not split
 * - Transaction not private (unless the reader owns it)
 * - Account not archived and hideTransactions = false
 */
export function transactionPrivacyFilters(actor: HouseholdContext): SQL<unknown>[] {
  return [
    eq(transactions.householdId, actor.householdId),
    visibleAccountPredicate(actor),
    isNull(transactions.deletedAt),
    or(eq(transactions.isPrivate, false), eq(transactions.ownerUserId, actor.userId))!,
    eq(transactions.isExcludedFromReports, false),
    eq(accounts.isArchived, false),
    eq(accounts.hideTransactions, false),
    sql`NOT EXISTS (
      SELECT 1 FROM transaction_splits
      WHERE transaction_splits.transaction_id = ${transactions.id}
    )`,
  ];
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
    isNull(accounts.deletedAt),
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
