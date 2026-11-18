import { eq, and, or, isNull, sql, desc, gte, lte, asc } from "drizzle-orm";
import { db } from "../db";
import {
  accounts,
  transactions,
  categories,
  tags,
  transactionTags,
  accountBalanceSnapshots,
  netWorthSnapshots,
  type Account,
  type InsertAccount,
} from "@shared/schema";
import {
  withTransaction,
  type TransactionType,
} from "../utils/withTransaction";
import { accountSnapshotRepository } from "./AccountSnapshotRepository";

/**
 * AccountRepository
 *
 * Provides typed query builders for account operations.
 * Implements Phase 1 requirements:
 * - Household-scoped queries
 * - Privacy/visibility filtering
 * - Soft delete
 * - Balance management
 * - Optimistic concurrency
 */
export class AccountRepository {
  /**
   * Find all accounts for a household with optional filtering
   */
  async findByHousehold(
    householdId: string,
    options?: {
      includeArchived?: boolean;
      includeHidden?: boolean;
      includeDeleted?: boolean;
    },
  ): Promise<Account[]> {
    // Build conditions array
    const conditions = [eq(accounts.householdId, householdId)];

    if (!options?.includeDeleted) {
      conditions.push(isNull(accounts.deletedAt));
    }
    if (!options?.includeArchived) {
      conditions.push(eq(accounts.isArchived, false));
    }
    if (!options?.includeHidden) {
      conditions.push(eq(accounts.isHidden, false));
    }

    return await db
      .select()
      .from(accounts)
      .where(and(...conditions))
      .orderBy(accounts.displayOrder);
  }

  /**
   * Find accounts visible to a specific user (respects is_private)
   * Per Canonical Invariant 1.3: visible iff (is_private=false OR owner_user_id=userId)
   */
  async findByHouseholdWithVisibility(
    householdId: string,
    userId: string,
    options?: {
      includeArchived?: boolean;
      includeHidden?: boolean;
      ownerUserId?: string | null; // null = shared, string = specific user
    },
  ): Promise<Account[]> {
    const conditions = [
      eq(accounts.householdId, householdId),
      isNull(accounts.deletedAt),
    ];

    if (!options?.includeArchived) {
      conditions.push(eq(accounts.isArchived, false));
    }
    if (!options?.includeHidden) {
      conditions.push(eq(accounts.isHidden, false));
    }

    // Ownership filtering
    if (options?.ownerUserId !== undefined) {
      if (options.ownerUserId === null) {
        conditions.push(isNull(accounts.ownerUserId));
      } else {
        conditions.push(eq(accounts.ownerUserId, options.ownerUserId));
      }
    }

    // Enforce visibility at the SQL layer to avoid fetching private rows
    conditions.push(
      or(eq(accounts.isPrivate, false), eq(accounts.ownerUserId, userId))!,
    );

    const results = await db
      .select()
      .from(accounts)
      .where(and(...conditions))
      .orderBy(accounts.displayOrder);

    return results;
  }

  /**
   * Find a single account by ID within a household
   */
  async findById(
    id: string,
    householdId: string,
  ): Promise<Account | undefined> {
    const result = await db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, id),
          eq(accounts.householdId, householdId),
          isNull(accounts.deletedAt),
        ),
      )
      .limit(1);
    return result[0];
  }

  /**
   * Find account with visibility check
   */
  async findByIdWithVisibility(
    id: string,
    householdId: string,
    userId: string,
  ): Promise<Account | undefined> {
    const account = await this.findById(id, householdId);
    if (!account) return undefined;

    // Check visibility
    if (account.isPrivate && account.ownerUserId !== userId) {
      return undefined;
    }

    return account;
  }

  /**
   * Create a new account
   */
  async create(data: InsertAccount): Promise<Account> {
    const result = await db.insert(accounts).values(data).returning();
    return result[0];
  }

  /**
   * Update an existing account with optimistic concurrency check
   *
   * TODO-026 TOCTOU Fix: Added ownershipCheck param to add ownership predicate
   * to WHERE clause, preventing race condition between visibility check and update.
   *
   * TODO-018: Added optional tx param for transactional bulk operations.
   */
  async update(
    id: string,
    householdId: string,
    data: Partial<Account>,
    expectedUpdatedAt?: Date,
    ownershipCheck?: { userId: string },
    tx?: TransactionType,
  ): Promise<{ account?: Account; conflict: boolean; unauthorized?: boolean }> {
    const dbOrTx = tx ?? db;

    const conditions = [
      eq(accounts.id, id),
      eq(accounts.householdId, householdId),
      isNull(accounts.deletedAt),
    ];

    // Optimistic concurrency: check updated_at if provided
    if (expectedUpdatedAt) {
      conditions.push(eq(accounts.updatedAt, expectedUpdatedAt));
    }

    // TODO-026: TOCTOU fix - add ownership check in WHERE clause
    // Account must either be public OR owned by this user
    if (ownershipCheck) {
      conditions.push(
        or(
          eq(accounts.isPrivate, false),
          eq(accounts.ownerUserId, ownershipCheck.userId),
        )!,
      );
    }

    const result = await dbOrTx
      .update(accounts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    if (result.length === 0) {
      if (expectedUpdatedAt) {
        // Check if account exists but was updated by someone else
        const existing = await this.findById(id, householdId);
        if (existing) {
          return { account: undefined, conflict: true };
        }
      }

      // TODO-026: Check if it's an ownership/privacy issue
      if (ownershipCheck) {
        const existing = await this.findById(id, householdId);
        if (existing) {
          // Account exists but ownership check failed
          return { account: undefined, conflict: false, unauthorized: true };
        }
      }
    }

    return { account: result[0], conflict: false };
  }

  /**
   * Soft delete an account
   *
   * TODO-026: Added ownershipCheck for TOCTOU-safe privacy enforcement.
   * When provided, the WHERE clause includes ownership verification to prevent
   * race conditions where visibility could change between check and delete.
   */
  async softDelete(
    id: string,
    householdId: string,
    ownershipCheck?: { userId: string },
  ): Promise<{ deleted: boolean; unauthorized?: boolean }> {
    const conditions = [
      eq(accounts.id, id),
      eq(accounts.householdId, householdId),
      isNull(accounts.deletedAt),
    ];

    // TODO-026: TOCTOU fix - add ownership check in WHERE clause
    // Account must either be public OR owned by this user
    if (ownershipCheck) {
      conditions.push(
        or(
          eq(accounts.isPrivate, false),
          eq(accounts.ownerUserId, ownershipCheck.userId),
        )!,
      );
    }

    const result = await db
      .update(accounts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    if (result.length === 0 && ownershipCheck) {
      // Check if account exists but ownership check failed
      const existing = await this.findById(id, householdId);
      if (existing) {
        return { deleted: false, unauthorized: true };
      }
    }

    return { deleted: result.length > 0 };
  }

  /**
   * Restore a soft-deleted account
   */
  async restore(id: string, householdId: string): Promise<Account | undefined> {
    const result = await db
      .update(accounts)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(accounts.id, id), eq(accounts.householdId, householdId)))
      .returning();
    return result[0];
  }

  /**
   * Archive an account
   *
   * Added ownershipCheck for TOCTOU-safe privacy enforcement.
   * When provided, the WHERE clause includes ownership verification to prevent
   * race conditions where visibility could change between check and archive.
   */
  async archive(
    id: string,
    householdId: string,
    ownershipCheck?: { userId: string },
  ): Promise<{ account?: Account; unauthorized?: boolean }> {
    const conditions = [
      eq(accounts.id, id),
      eq(accounts.householdId, householdId),
      isNull(accounts.deletedAt),
    ];

    // TOCTOU fix - add ownership check in WHERE clause
    // Account must either be public OR owned by this user
    if (ownershipCheck) {
      conditions.push(
        or(
          eq(accounts.isPrivate, false),
          eq(accounts.ownerUserId, ownershipCheck.userId),
        )!,
      );
    }

    const result = await db
      .update(accounts)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    if (result.length === 0 && ownershipCheck) {
      // Check if account exists but ownership check failed
      const existing = await this.findById(id, householdId);
      if (existing) {
        return { account: undefined, unauthorized: true };
      }
    }

    return { account: result[0] };
  }

  /**
   * Unarchive an account
   *
   * Added ownershipCheck for TOCTOU-safe privacy enforcement.
   * When provided, the WHERE clause includes ownership verification to prevent
   * race conditions where visibility could change between check and unarchive.
   */
  async unarchive(
    id: string,
    householdId: string,
    ownershipCheck?: { userId: string },
  ): Promise<{ account?: Account; unauthorized?: boolean }> {
    const conditions = [
      eq(accounts.id, id),
      eq(accounts.householdId, householdId),
    ];

    // TOCTOU fix - add ownership check in WHERE clause
    // Account must either be public OR owned by this user
    if (ownershipCheck) {
      conditions.push(
        or(
          eq(accounts.isPrivate, false),
          eq(accounts.ownerUserId, ownershipCheck.userId),
        )!,
      );
    }

    const result = await db
      .update(accounts)
      .set({ isArchived: false, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    if (result.length === 0 && ownershipCheck) {
      // Check if account exists but ownership check failed
      const existing = await this.findById(id, householdId);
      if (existing) {
        return { account: undefined, unauthorized: true };
      }
    }

    return { account: result[0] };
  }

  /**
   * Get account balances for net worth calculation
   * Returns only visible, non-hidden, non-deleted, non-excluded accounts
   * TODO-005: Now honors excludeFromNetWorth and isArchived flags
   */
  async getBalancesForNetWorth(
    householdId: string,
    userId?: string,
    options?: { includeArchived?: boolean },
  ): Promise<
    {
      id: string;
      balance: string;
      isAsset: boolean;
      type: string;
      currency: string;
    }[]
  > {
    const conditions = [
      eq(accounts.householdId, householdId),
      isNull(accounts.deletedAt),
      eq(accounts.isHidden, false),
      eq(accounts.excludeFromNetWorth, false), // TODO-005: Exclude accounts marked as excluded
    ];

    // Default: exclude archived unless explicitly requested
    if (!options?.includeArchived) {
      conditions.push(eq(accounts.isArchived, false));
    }

    // Enforce visibility at the SQL layer when a user context is provided
    if (userId) {
      conditions.push(
        or(eq(accounts.isPrivate, false), eq(accounts.ownerUserId, userId))!,
      );
    }

    const balanceExpression = sql<string>`
      CASE
        WHEN ${accounts.type} IN ('real_estate', 'vehicle')
          AND ${accounts.estimatedValue} IS NOT NULL
          THEN ${accounts.estimatedValue}
        ELSE ${accounts.balance}
      END
    `;

    const results = await db
      .select({
        id: accounts.id,
        balance: balanceExpression,
        isAsset: accounts.isAsset,
        type: accounts.type,
        currency: accounts.currency,
        isPrivate: accounts.isPrivate,
        ownerUserId: accounts.ownerUserId,
      })
      .from(accounts)
      .where(and(...conditions));

    if (userId) {
      return results.map(({ isPrivate, ownerUserId, ...rest }) => rest);
    }

    return results.map(({ isPrivate, ownerUserId, ...rest }) => rest);
  }

  /**
   * Count accounts in a household
   */
  async countByHousehold(householdId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(accounts)
      .where(
        and(eq(accounts.householdId, householdId), isNull(accounts.deletedAt)),
      );
    return Number(result[0]?.count ?? 0);
  }

  /**
   * Get next display order value
   */
  async getNextDisplayOrder(householdId: string): Promise<number> {
    const result = await db
      .select({ maxOrder: sql<number>`COALESCE(MAX(display_order), -1)` })
      .from(accounts)
      .where(eq(accounts.householdId, householdId));
    return (result[0]?.maxOrder ?? -1) + 1;
  }

  /**
   * Get net worth snapshots for a date range
   * @deprecated Use accountSnapshotRepository.getNetWorthSnapshots directly
   */
  async getNetWorthSnapshots(
    householdId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<
    {
      date: string;
      totalAssets: string;
      totalLiabilities: string;
      netWorth: string;
    }[]
  > {
    return accountSnapshotRepository.getNetWorthSnapshots(
      householdId,
      startDate,
      endDate,
    );
  }

  /**
   * Get balance snapshots for an account within a date range
   * @deprecated Use accountSnapshotRepository.getBalanceSnapshots directly
   */
  async getBalanceSnapshots(
    accountId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ date: string; balance: string }[]> {
    return accountSnapshotRepository.getBalanceSnapshots(
      accountId,
      startDate,
      endDate,
    );
  }

  /**
   * Import balance snapshots for an account
   * @deprecated Use accountSnapshotRepository.importBalanceSnapshots directly
   */
  async importBalanceSnapshots(
    accountId: string,
    data: { date: string; balance: string }[],
  ): Promise<number> {
    return accountSnapshotRepository.importBalanceSnapshots(accountId, data);
  }

  /**
   * Get transactions for an account with category names
   */
  async getTransactionsForAccount(
    accountId: string,
    householdId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<
    {
      id: string;
      date: string;
      name: string;
      originalName: string | null;
      amount: string;
      type: string;
      notes: string | null;
      categoryName: string | null;
      tags: string[] | null;
    }[]
  > {
    const conditions = [
      eq(transactions.accountId, accountId),
      eq(transactions.householdId, householdId),
      isNull(transactions.deletedAt),
    ];

    if (startDate) {
      conditions.push(gte(transactions.date, startDate));
    }
    if (endDate) {
      conditions.push(lte(transactions.date, endDate));
    }

    const results = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        name: transactions.name,
        originalName: transactions.originalName,
        amount: transactions.amount,
        type: transactions.type,
        notes: transactions.notes,
        categoryName: categories.name,
        tags: sql<string[]>`COALESCE(array_agg(${tags.name}) FILTER (WHERE ${tags.name} IS NOT NULL), ARRAY[]::text[])`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(transactionTags, eq(transactionTags.transactionId, transactions.id))
      .leftJoin(tags, eq(tags.id, transactionTags.tagId))
      .where(and(...conditions))
      .groupBy(transactions.id, categories.name)
      .orderBy(desc(transactions.date));

    return results.map((r) => ({
      ...r,
      tags: r.tags ?? [],
    }));
  }
}

// Export singleton instance
export const accountRepository = new AccountRepository();
