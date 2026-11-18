/**
 * BudgetSpendBatchQueries
 *
 * Batch query helpers for budget spend calculations.
 * Extracted from BudgetSpendRepository to manage LOC limits.
 */

import { db } from "../db";
import {
  transactions,
  transactionSplits,
  categories,
} from "@shared/schema";
import { eq, and, inArray, isNull, sql, gte, lte } from "drizzle-orm";
import { Money } from "../core/money";

/**
 * Calculate spent amounts per category from non-split transactions
 */
export async function calculateCategorySpentNonSplit(
  householdId: string,
  categoryIds: string[],
  startDate: string,
  endDate: string,
): Promise<Array<{ categoryId: string | null; type: string; total: string }>> {
  if (categoryIds.length === 0) return [];

  return db
    .select({
      categoryId: transactions.categoryId,
      type: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        inArray(transactions.categoryId, categoryIds),
        eq(transactions.isExcludedFromBudget, false),
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
    )
    .groupBy(transactions.categoryId, transactions.type);
}

/**
 * Calculate spent amounts per category from split transactions
 */
export async function calculateCategorySpentSplit(
  householdId: string,
  categoryIds: string[],
  startDate: string,
  endDate: string,
): Promise<Array<{ categoryId: string | null; type: string; total: string }>> {
  if (categoryIds.length === 0) return [];

  return db
    .select({
      categoryId: transactionSplits.categoryId,
      type: transactions.type,
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
        inArray(transactionSplits.categoryId, categoryIds),
        eq(transactions.isExcludedFromBudget, false),
        isNull(transactions.deletedAt),
        gte(transactions.date, startDate),
        lte(transactions.date, endDate),
      ),
    )
    .groupBy(transactionSplits.categoryId, transactions.type);
}

/**
 * Calculate spent amounts per category group from non-split transactions
 */
export async function calculateGroupSpentNonSplit(
  householdId: string,
  categoryGroupIds: string[],
  startDate: string,
  endDate: string,
): Promise<Array<{ groupId: string | null; type: string; total: string }>> {
  if (categoryGroupIds.length === 0) return [];

  return db
    .select({
      groupId: categories.groupId,
      type: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        inArray(categories.groupId, categoryGroupIds),
        eq(transactions.isExcludedFromBudget, false),
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
    )
    .groupBy(categories.groupId, transactions.type);
}

/**
 * Calculate spent amounts per category group from split transactions
 */
export async function calculateGroupSpentSplit(
  householdId: string,
  categoryGroupIds: string[],
  startDate: string,
  endDate: string,
): Promise<Array<{ groupId: string | null; type: string; total: string }>> {
  if (categoryGroupIds.length === 0) return [];

  return db
    .select({
      groupId: categories.groupId,
      type: transactions.type,
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
        inArray(categories.groupId, categoryGroupIds),
        eq(transactions.isExcludedFromBudget, false),
        isNull(transactions.deletedAt),
        gte(transactions.date, startDate),
        lte(transactions.date, endDate),
      ),
    )
    .groupBy(categories.groupId, transactions.type);
}

/**
 * Aggregate query results into Money maps by category/group
 */
export function aggregateSpentResults(
  categoryResults: Array<{ categoryId: string | null; type: string; total: string }>,
  groupResults: Array<{ groupId: string | null; type: string; total: string }>,
  categoryTypeMap: Map<string, "income" | "expense">,
  groupTypeMap: Map<string, "income" | "expense">,
  currency: string,
): {
  byCategoryId: Map<string, Money>;
  byCategoryGroupId: Map<string, Money>;
} {
  const byCategoryId = new Map<string, Money>();
  const byCategoryGroupId = new Map<string, Money>();

  // Process category results
  for (const row of categoryResults) {
    if (row.categoryId) {
      const expectedType = categoryTypeMap.get(row.categoryId) || "expense";
      if (row.type === expectedType) {
        const existing = byCategoryId.get(row.categoryId) || Money.zero(currency);
        byCategoryId.set(
          row.categoryId,
          existing.add(Money.from(row.total, currency)),
        );
      }
    }
  }

  // Process group results
  for (const row of groupResults) {
    if (row.groupId) {
      const expectedType = groupTypeMap.get(row.groupId) || "expense";
      if (row.type === expectedType) {
        const existing = byCategoryGroupId.get(row.groupId) || Money.zero(currency);
        byCategoryGroupId.set(
          row.groupId,
          existing.add(Money.from(row.total, currency)),
        );
      }
    }
  }

  return { byCategoryId, byCategoryGroupId };
}
