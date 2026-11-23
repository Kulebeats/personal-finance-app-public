/**
 * BudgetSpendRepository
 *
 * Data access layer for budget spend calculations.
 * Extracted from BudgetRepository to manage LOC limits.
 *
 * Provides:
 * - Category spend calculations
 * - Category group spend calculations
 * - Flex budget spend calculations
 * - Batch spend calculations
 */
import { db } from "../db";
import {
  transactions,
  transactionSplits,
  categories,
  categoryGroups,
} from "@shared/schema";
import { eq, and, isNull, sql, gte, lte } from "drizzle-orm";
import { Money } from "../core/money";
import { calculateBudgetSpentBatch } from "./BudgetSpendBatchQueries";
import type { BudgetReadContext } from "./BudgetReadContext";

export class BudgetSpendRepository {
  /**
   * Calculate spent amount for a category in a date range
   * Excludes transactions marked with isExcludedFromBudget
   */
  async calculateSpent(
    householdId: string,
    categoryId: string,
    startDate: string,
    endDate: string,
    transactionType: "income" | "expense" = "expense",
    currency: string = "ZMW",
  ): Promise<Money> {
    const result = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.categoryId, categoryId),
          eq(transactions.type, transactionType),
          eq(transactions.isExcludedFromBudget, false),
          eq(transactions.isPending, false),
          sql`${transactions.status} IS DISTINCT FROM 'pending'`,
          eq(categories.includeInBudget, true),
          eq(categories.isArchived, false),
          isNull(transactions.deletedAt),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate),
          sql`NOT EXISTS (
            SELECT 1 FROM transaction_splits
            WHERE transaction_splits.transaction_id = ${transactions.id}
          )`,
        ),
      );

    return Money.from(result[0]?.total || "0", currency);
  }

  /**
   * Calculate spent amount for a category group in a date range
   * Sums all transactions in categories belonging to the group
   */
  async calculateGroupSpent(
    householdId: string,
    categoryGroupId: string,
    startDate: string,
    endDate: string,
    transactionType: "income" | "expense" = "expense",
    currency: string = "ZMW",
  ): Promise<Money> {
    const result = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(categories.groupId, categoryGroupId),
          eq(transactions.type, transactionType),
          eq(transactions.isExcludedFromBudget, false),
          eq(transactions.isPending, false),
          sql`${transactions.status} IS DISTINCT FROM 'pending'`,
          eq(categories.includeInBudget, true),
          eq(categories.isArchived, false),
          isNull(transactions.deletedAt),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate),
          sql`NOT EXISTS (
            SELECT 1 FROM transaction_splits
            WHERE transaction_splits.transaction_id = ${transactions.id}
          )`,
        ),
      );

    return Money.from(result[0]?.total || "0", currency);
  }

  /**
   * Calculate spent amount for the flex budget in a date range
   * Sums all expense transactions for budgetable categories
   */
  async calculateFlexSpent(
    householdId: string,
    startDate: string,
    endDate: string,
    currency: string = "ZMW",
  ): Promise<Money> {
    const result = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.type, "expense"),
          eq(transactions.isExcludedFromBudget, false),
          eq(transactions.isPending, false),
          sql`${transactions.status} IS DISTINCT FROM 'pending'`,
          eq(categories.includeInBudget, true),
          eq(categories.isArchived, false),
          eq(categoryGroups.isArchived, false),
          isNull(transactions.deletedAt),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate),
          sql`NOT EXISTS (
            SELECT 1 FROM transaction_splits
            WHERE transaction_splits.transaction_id = ${transactions.id}
          )`,
        ),
      );

    return Money.from(result[0]?.total || "0", currency);
  }

  /**
   * Calculate spent amount for a category group including transaction splits.
   * - For transactions WITH splits: sums split amounts for categories in the group
   * - For transactions WITHOUT splits: sums transaction amounts for categories in the group
   * - Prevents double-counting
   */
  async calculateGroupSpentWithSplits(
    householdId: string,
    categoryGroupId: string,
    startDate: string,
    endDate: string,
    transactionType: "income" | "expense" = "expense",
    currency: string = "ZMW",
  ): Promise<Money> {
    // Query 1: Sum split amounts for categories in this group
    const splitResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactionSplits.amount}), '0')`,
      })
      .from(transactionSplits)
      .innerJoin(
        transactions,
        eq(transactionSplits.transactionId, transactions.id),
      )
      .innerJoin(categories, eq(transactionSplits.categoryId, categories.id))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(categories.groupId, categoryGroupId),
          eq(transactions.type, transactionType),
          // Count ordinary split parents, but preserve explicit hide/exclude.
          eq(transactions.isExcludedFromBudget, false),
          eq(transactions.isPending, false),
          sql`${transactions.status} IS DISTINCT FROM 'pending'`,
          isNull(transactions.deletedAt),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate),
        ),
      );

    // Query 2: Sum transaction amounts for transactions WITHOUT splits
    const nonSplitResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(categories.groupId, categoryGroupId),
          eq(transactions.type, transactionType),
          eq(transactions.isExcludedFromBudget, false),
          eq(transactions.isPending, false),
          sql`${transactions.status} IS DISTINCT FROM 'pending'`,
          eq(categories.includeInBudget, true),
          eq(categories.isArchived, false),
          isNull(transactions.deletedAt),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate),
          sql`NOT EXISTS (
            SELECT 1 FROM transaction_splits
            WHERE transaction_splits.transaction_id = ${transactions.id}
          )`,
        ),
      );

    const splitTotal = Money.from(splitResult[0]?.total || "0", currency);
    const nonSplitTotal = Money.from(nonSplitResult[0]?.total || "0", currency);

    return splitTotal.add(nonSplitTotal);
  }

  /**
   * Calculate spent amount for the flex budget including transaction splits.
   * - For transactions WITH splits: sums split amounts for budgetable categories
   * - For transactions WITHOUT splits: sums transaction amounts for budgetable categories
   * - Prevents double-counting
   */
  async calculateFlexSpentWithSplits(
    householdId: string,
    startDate: string,
    endDate: string,
    currency: string = "ZMW",
  ): Promise<Money> {
    // Query 1: Sum split amounts for budgetable categories
    const splitResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactionSplits.amount}), '0')`,
      })
      .from(transactionSplits)
      .innerJoin(
        transactions,
        eq(transactionSplits.transactionId, transactions.id),
      )
      .innerJoin(categories, eq(transactionSplits.categoryId, categories.id))
      .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.type, "expense"),
          // Count ordinary split parents, but preserve explicit hide/exclude.
          eq(transactions.isExcludedFromBudget, false),
          eq(transactions.isPending, false),
          sql`${transactions.status} IS DISTINCT FROM 'pending'`,
          eq(categories.includeInBudget, true),
          eq(categories.isArchived, false),
          eq(categoryGroups.isArchived, false),
          isNull(transactions.deletedAt),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate),
        ),
      );

    // Query 2: Sum transaction amounts for transactions WITHOUT splits
    const nonSplitResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.type, "expense"),
          eq(transactions.isExcludedFromBudget, false),
          eq(transactions.isPending, false),
          sql`${transactions.status} IS DISTINCT FROM 'pending'`,
          eq(categories.includeInBudget, true),
          eq(categories.isArchived, false),
          eq(categoryGroups.isArchived, false),
          isNull(transactions.deletedAt),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate),
          sql`NOT EXISTS (
            SELECT 1 FROM transaction_splits
            WHERE transaction_splits.transaction_id = ${transactions.id}
          )`,
        ),
      );

    const splitTotal = Money.from(splitResult[0]?.total || "0", currency);
    const nonSplitTotal = Money.from(nonSplitResult[0]?.total || "0", currency);

    return splitTotal.add(nonSplitTotal);
  }

  /**
   * Calculate spent amount for a category including transaction splits.
   * - For transactions WITH splits: sums split amounts for this category
   * - For transactions WITHOUT splits: sums transaction amounts for this category
   * - Prevents double-counting
   */
  async calculateSpentWithSplits(
    householdId: string,
    categoryId: string,
    startDate: string,
    endDate: string,
    transactionType: "income" | "expense" = "expense",
    currency: string = "ZMW",
  ): Promise<Money> {
    // Query 1: Sum split amounts for this category
    const splitResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactionSplits.amount}), '0')`,
      })
      .from(transactionSplits)
      .innerJoin(
        transactions,
        eq(transactionSplits.transactionId, transactions.id),
      )
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactionSplits.categoryId, categoryId),
          eq(transactions.type, transactionType),
          // Count ordinary split parents, but preserve explicit hide/exclude.
          eq(transactions.isExcludedFromBudget, false),
          eq(transactions.isPending, false),
          sql`${transactions.status} IS DISTINCT FROM 'pending'`,
          isNull(transactions.deletedAt),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate),
        ),
      );

    // Query 2: Sum transaction amounts for transactions WITHOUT splits
    const nonSplitResult = await db
      .select({
        total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(transactions.categoryId, categoryId),
          eq(transactions.type, transactionType),
          eq(transactions.isExcludedFromBudget, false),
          eq(transactions.isPending, false),
          sql`${transactions.status} IS DISTINCT FROM 'pending'`,
          eq(categories.includeInBudget, true),
          eq(categories.isArchived, false),
          isNull(transactions.deletedAt),
          gte(transactions.date, startDate),
          lte(transactions.date, endDate),
          sql`NOT EXISTS (
            SELECT 1 FROM transaction_splits
            WHERE transaction_splits.transaction_id = ${transactions.id}
          )`,
        ),
      );

    const splitTotal = Money.from(splitResult[0]?.total || "0", currency);
    const nonSplitTotal = Money.from(nonSplitResult[0]?.total || "0", currency);

    return splitTotal.add(nonSplitTotal);
  }

  /**
   * Batch calculate spent amounts for multiple categories/groups in a single query.
   * Returns a map of categoryId/categoryGroupId -> spent amount.
   */
  async batchCalculateSpent(
    householdId: string,
    categoryIds: string[],
    categoryGroupIds: string[],
    startDate: string,
    endDate: string,
    currency: string = "ZMW",
    categoryTypeMap: Map<string, "income" | "expense">,
    groupTypeMap: Map<string, "income" | "expense">,
    context: BudgetReadContext,
    includeFlex = true,
  ): Promise<{
    byCategoryId: Map<string, Money>;
    byCategoryGroupId: Map<string, Money>;
    flexTotal: Money;
  }> {
    return calculateBudgetSpentBatch(householdId, categoryIds, categoryGroupIds, startDate, endDate,
      currency, categoryTypeMap, groupTypeMap, context, includeFlex);
  }
}

// Export singleton instance
export const budgetSpendRepository = new BudgetSpendRepository();
