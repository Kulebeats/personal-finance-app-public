/**
 * Transaction Query Repository
 *
 * Query methods for fetching transactions with filtering and visibility.
 * Split from TransactionRepository to keep file sizes under 500 LOC.
 *
 * @module repositories/TransactionQueryRepository
 */

import {
  eq,
  and,
  isNull,
  sql,
  desc,
  asc,
  or,
  gte,
  lte,
  inArray,
} from "drizzle-orm";
import { db } from "../db";
import {
  transactions,
  accounts,
  merchants,
  categories,
  transactionTags,
  type Transaction,
} from "@shared/schema";
import type { TransactionWithNames } from "./TransactionRepository";

/**
 * Transaction Query Repository
 *
 * Handles transaction listing and search operations.
 */
export class TransactionQueryRepository {
  /**
   * Find all transactions for a household with pagination and filtering
   */
  async findByHousehold(
    householdId: string,
    options?: {
      limit?: number;
      offset?: number;
      accountId?: string;
      categoryId?: string;
      type?: string;
      startDate?: string;
      endDate?: string;
      includeDeleted?: boolean;
      includePending?: boolean;
      ownerUserId?: string | null;
      sortBy?: "date" | "amount" | "description";
      sortOrder?: "asc" | "desc";
      search?: string;
      merchantId?: string;
      amountMin?: string;
      amountMax?: string;
      reviewed?: "reviewed" | "unreviewed";
      tagIds?: string[];
      /**
       * Internal visibility gate used by findByHouseholdWithVisibility.
       * When set, transaction and account privacy predicates are applied in SQL
       * before limit/offset so invisible rows cannot consume page slots.
       */
      visibleToUserId?: string;
    },
  ): Promise<TransactionWithNames[]> {
    const conditions = [eq(transactions.householdId, householdId)];

    if (!options?.includeDeleted) {
      conditions.push(isNull(transactions.deletedAt));
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

    if (!options?.includePending) {
      conditions.push(eq(transactions.isPending, false));
    }

    if (options?.ownerUserId !== undefined) {
      if (options.ownerUserId === null) {
        conditions.push(isNull(transactions.ownerUserId));
      } else {
        conditions.push(eq(transactions.ownerUserId, options.ownerUserId));
      }
    }

    // Merchant filter
    if (options?.merchantId) {
      conditions.push(eq(transactions.merchantId, options.merchantId));
    }

    // Amount range filters (applied to absolute amount value)
    if (options?.amountMin) {
      conditions.push(gte(transactions.amount, options.amountMin));
    }
    if (options?.amountMax) {
      conditions.push(lte(transactions.amount, options.amountMax));
    }

    // Reviewed filter
    if (options?.reviewed === "reviewed") {
      conditions.push(sql`${transactions.reviewedAt} IS NOT NULL`);
    } else if (options?.reviewed === "unreviewed") {
      conditions.push(isNull(transactions.reviewedAt));
    }

    // Search filter: match on name, originalName, notes, OR merchant name via subquery
    if (options?.search) {
      const searchPattern = `%${options.search}%`;
      const searchCondition = or(
        sql`LOWER(${transactions.name}) LIKE LOWER(${searchPattern})`,
        sql`LOWER(${transactions.originalName}) LIKE LOWER(${searchPattern})`,
        sql`LOWER(${transactions.notes}) LIKE LOWER(${searchPattern})`,
        // Subquery to search merchant name
        sql`${transactions.merchantId} IN (
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
    // Tags are validated at the service level to ensure they belong to the household
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

    if (options?.visibleToUserId) {
      const transactionVisible = or(
        eq(transactions.isPrivate, false),
        eq(transactions.ownerUserId, options.visibleToUserId),
      );
      if (transactionVisible) {
        conditions.push(transactionVisible);
      }

      conditions.push(
        sql`${transactions.accountId} IN (
          SELECT ${accounts.id} FROM ${accounts}
          WHERE ${accounts.householdId} = ${householdId}
          AND ${accounts.deletedAt} IS NULL
          AND (${accounts.isPrivate} = false OR ${accounts.ownerUserId} = ${options.visibleToUserId})
        )`,
      );
    }

    // Build dynamic orderBy based on sortBy and sortOrder
    const sortBy = options?.sortBy || "date";
    const sortOrder = options?.sortOrder || "desc";
    const orderFn = sortOrder === "asc" ? asc : desc;

    // Map sortBy to column (description maps to name field)
    const sortColumn =
      sortBy === "date"
        ? transactions.date
        : sortBy === "amount"
          ? transactions.amount
          : transactions.name; // "description" maps to name column

    // Query transactions with dynamic sorting
    // Secondary sort by createdAt for stable ordering when primary sort values are equal
    const baseQuery = db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(orderFn(sortColumn), desc(transactions.createdAt));

    const queryWithLimit = options?.limit
      ? baseQuery.limit(options.limit)
      : baseQuery;
    const queryWithOffset = options?.offset
      ? queryWithLimit.offset(options.offset)
      : queryWithLimit;

    const txns = await queryWithOffset;
    if (txns.length === 0) return [];

    // Batch fetch denormalized names
    const merchantIds = Array.from(
      new Set(
        txns.map((t) => t.merchantId).filter((id): id is string => id != null),
      ),
    );
    const categoryIds = Array.from(
      new Set(
        txns.map((t) => t.categoryId).filter((id): id is string => id != null),
      ),
    );
    const accountIds = Array.from(new Set(txns.map((t) => t.accountId)));

    // Fetch names in parallel
    const [merchantResults, categoryResults, accountResults] =
      await Promise.all([
        merchantIds.length > 0
          ? db
              .select({
                id: merchants.id,
                name: merchants.name,
                logoUrl: merchants.logoUrl,
              })
              .from(merchants)
              .where(inArray(merchants.id, merchantIds))
          : Promise.resolve([]),
        categoryIds.length > 0
          ? db
              .select({ id: categories.id, name: categories.name })
              .from(categories)
              .where(inArray(categories.id, categoryIds))
          : Promise.resolve([]),
        accountIds.length > 0
          ? db
              .select({ id: accounts.id, name: accounts.name })
              .from(accounts)
              .where(inArray(accounts.id, accountIds))
          : Promise.resolve([]),
      ]);

    // Create lookup maps
    const merchantMap = new Map(
      merchantResults.map((m) => [m.id, { name: m.name, logoUrl: m.logoUrl }]),
    );
    const categoryMap = new Map(categoryResults.map((c) => [c.id, c.name]));
    const accountMap = new Map(accountResults.map((a) => [a.id, a.name]));

    // Enrich transactions with names
    return txns.map((txn) => ({
      ...txn,
      merchantName: txn.merchantId
        ? merchantMap.get(txn.merchantId)?.name || null
        : null,
      merchantLogoUrl: txn.merchantId
        ? merchantMap.get(txn.merchantId)?.logoUrl || null
        : null,
      categoryName: txn.categoryId
        ? categoryMap.get(txn.categoryId) || null
        : null,
      accountName: accountMap.get(txn.accountId) || null,
    }));
  }

  /**
   * Find transactions with visibility filtering
   * Per Canonical Invariant 1.3: A transaction is visible iff:
   * - (is_private=false OR owner_user_id=userId) AND
   * - The referenced account is also visible (account.is_private=false OR account.owner_user_id=userId)
   */
  async findByHouseholdWithVisibility(
    householdId: string,
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      accountId?: string;
      categoryId?: string;
      merchantId?: string;
      type?: string;
      startDate?: string;
      endDate?: string;
      ownerUserId?: string | null;
      sortBy?: "date" | "amount" | "description";
      sortOrder?: "asc" | "desc";
      search?: string;
      amountMin?: string;
      amountMax?: string;
      reviewed?: "reviewed" | "unreviewed";
      tagIds?: string[];
      // R-07: Allow pending preference to be passed through
      includePending?: boolean;
    },
  ): Promise<Transaction[]> {
    return await this.findByHousehold(householdId, {
      ...options,
      includeDeleted: false,
      // R-07: Wire pending preference (default true for backwards compatibility)
      includePending: options?.includePending ?? true,
      ownerUserId: options?.ownerUserId,
      visibleToUserId: userId,
    });
  }

  /**
   * Find transactions for recurring pattern detection
   */
  async findForPatternDetection(
    householdId: string,
    options?: {
      startDate?: string;
      endDate?: string;
      lookbackMonths?: number;
      merchantId?: string;
      categoryId?: string;
    },
  ): Promise<Transaction[]> {
    const endDate = options?.endDate || new Date().toISOString().split("T")[0];
    let startDate = options?.startDate;
    if (!startDate && options?.lookbackMonths) {
      const start = new Date();
      start.setMonth(start.getMonth() - options.lookbackMonths);
      startDate = start.toISOString().split("T")[0];
    }

    const conditions = [
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
      eq(transactions.isPending, false),
      inArray(transactions.type, ["income", "expense"]),
      eq(transactions.isRecurring, false),
    ];

    if (startDate) {
      conditions.push(gte(transactions.date, startDate));
    }

    if (endDate) {
      conditions.push(lte(transactions.date, endDate));
    }

    if (options?.merchantId) {
      conditions.push(eq(transactions.merchantId, options.merchantId));
    }

    if (options?.categoryId) {
      conditions.push(eq(transactions.categoryId, options.categoryId));
    }

    return await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.date));
  }
}

// Export singleton instance
export const transactionQueryRepository = new TransactionQueryRepository();
