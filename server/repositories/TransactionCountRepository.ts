/**
 * Transaction Count Repository
 *
 * Count operations for transactions with filtering.
 * Split from TransactionRepository to keep file sizes under 500 LOC.
 *
 * @module repositories/TransactionCountRepository
 */

import { eq, and, isNull, sql, or, gte, lte } from "drizzle-orm";
import { db } from "../db";
import { couponCashDescriptionFields } from "../services/grz/couponCashDescription";
import { postedTransactionPredicate } from "./postedTransactionPredicate";
import {
  transactions,
  accounts,
  merchants,
  transactionTags,
} from "@shared/schema";

/**
 * Transaction Count Repository
 *
 * Handles count operations for pagination and analytics.
 */
export class TransactionCountRepository {
  /**
   * Count transactions for a household
   */
  async countByHousehold(
    householdId: string,
    options?: { type?: string },
  ): Promise<number> {
    const conditions = [
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
    ];

    if (options?.type) {
      conditions.push(sql`${transactions.type} = ${options.type}`);
    }

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(...conditions));

    return Number(result[0]?.count ?? 0);
  }

  /**
   * Count transactions with visibility filtering
   * Mirrors the same visibility rules and filters as findByHouseholdWithVisibility
   */
  async countByHouseholdWithVisibility(
    householdId: string,
    userId: string,
    options?: {
      accountId?: string;
      categoryId?: string;
      merchantId?: string;
      type?: string;
      startDate?: string;
      endDate?: string;
      ownerUserId?: string | null;
      search?: string;
      amountMin?: string;
      amountMax?: string;
      reviewed?: "reviewed" | "unreviewed";
      tagIds?: string[];
      // R-07: Allow pending preference to be passed through
      includePending?: boolean;
    },
  ): Promise<number> {
    // Build conditions mirroring findByHousehold filters
    const cashDescription = couponCashDescriptionFields();
    const conditions = [
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
    ];

    // R-07: Mirror pending filter from findByHousehold
    if (!options?.includePending) {
      conditions.push(postedTransactionPredicate);
    }

    if (options?.accountId) {
      conditions.push(eq(transactions.accountId, options.accountId));
    }

    if (options?.categoryId) {
      conditions.push(eq(transactions.categoryId, options.categoryId));
    }

    if (options?.type) {
      conditions.push(sql`${transactions.type} = ${options.type}`);
    }

    if (options?.startDate) {
      conditions.push(gte(transactions.date, options.startDate));
    }

    if (options?.endDate) {
      conditions.push(lte(transactions.date, options.endDate));
    }

    if (options?.ownerUserId !== undefined) {
      if (options.ownerUserId === null) {
        conditions.push(isNull(transactions.ownerUserId));
      } else {
        conditions.push(eq(transactions.ownerUserId, options.ownerUserId));
      }
    }

    if (options?.merchantId) {
      conditions.push(eq(cashDescription.merchantId, options.merchantId));
    }

    if (options?.amountMin) {
      conditions.push(gte(transactions.amount, options.amountMin));
    }
    if (options?.amountMax) {
      conditions.push(lte(transactions.amount, options.amountMax));
    }

    if (options?.reviewed === "reviewed") {
      conditions.push(sql`${transactions.reviewedAt} IS NOT NULL`);
    } else if (options?.reviewed === "unreviewed") {
      conditions.push(isNull(transactions.reviewedAt));
    }

    if (options?.search) {
      const searchPattern = `%${options.search}%`;
      const searchCondition = or(
        sql`LOWER(${cashDescription.name}) LIKE LOWER(${searchPattern})`,
        sql`LOWER(${cashDescription.originalName}) LIKE LOWER(${searchPattern})`,
        sql`LOWER(${cashDescription.notes}) LIKE LOWER(${searchPattern})`,
        sql`${cashDescription.merchantId} IN (
          SELECT ${merchants.id} FROM ${merchants}
          WHERE ${merchants.householdId} = ${householdId}
          AND LOWER(${merchants.name}) LIKE LOWER(${searchPattern})
        )`,
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    // Tag filter: match transactions that have ANY of the specified tags (OR logic)
    if (options?.tagIds && options.tagIds.length > 0) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${transactionTags}
          WHERE ${transactionTags.transactionId} = ${transactions.id}
          AND ${transactionTags.tagId} IN (${sql.join(
            options.tagIds.map((id) => sql`${id}`),
            sql`, `,
          )})
        )`,
      );
    }

    // Add visibility conditions:
    // Transaction is visible if: (is_private=false OR owner_user_id=userId)
    // AND account is visible: (account.is_private=false OR account.owner_user_id=userId)
    const visibilityCondition = or(
      eq(transactions.isPrivate, false),
      eq(transactions.ownerUserId, userId),
    );
    if (visibilityCondition) {
      conditions.push(visibilityCondition);
    }

    // Account visibility via subquery
    conditions.push(
      sql`${transactions.accountId} IN (
        SELECT ${accounts.id} FROM ${accounts}
        WHERE ${accounts.householdId} = ${householdId}
        AND ${accounts.deletedAt} IS NULL
        AND (${accounts.isPrivate} = false OR ${accounts.ownerUserId} = ${userId})
      )`,
    );

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(...conditions));

    return Number(result[0]?.count ?? 0);
  }
}

// Export singleton instance
export const transactionCountRepository = new TransactionCountRepository();
