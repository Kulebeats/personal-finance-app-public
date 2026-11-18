import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../db";
import { withTransaction } from "../../utils/withTransaction";
import { Money } from "../../core/money";
import {
  budgets,
  categories,
  categoryGroups,
  households,
  transactions,
  transactionSplits,
} from "@shared/schema";
import { BudgetForecastService } from "./BudgetForecastService";
// BUDGET-TIME-001: Import timezone-safe date utilities
import { getMonthStart, getMonthEnd } from "../../utils/dateUtils";

export class BudgetRecalculationService extends BudgetForecastService {
  async recalculateBudgets(
    householdId: string,
    monthsBack: number,
  ): Promise<{ updated: number; created: number; cleared: number }> {
    // BUDGET-TIME-001: Use UTC to avoid timezone issues
    const now = new Date();
    const endMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)
    );
    const startMonth = new Date(
      Date.UTC(
        endMonth.getUTCFullYear(),
        endMonth.getUTCMonth() - (monthsBack - 1),
        1
      )
    );

    const startDate = getMonthStart(
      startMonth.getUTCFullYear(),
      startMonth.getUTCMonth() + 1,
    );
    const endDate = getMonthEnd(
      endMonth.getUTCFullYear(),
      endMonth.getUTCMonth() + 1,
    );

    const categoryRows = await db
      .select({
        categoryId: categories.id,
        categoryName: categories.name,
        groupId: categories.groupId,
        groupName: categoryGroups.name,
        groupBudgetMode: categoryGroups.budgetMode,
        groupType: categoryGroups.type,
        groupArchived: categoryGroups.isArchived,
        categoryArchived: categories.isArchived,
        includeInBudget: categories.includeInBudget,
      })
      .from(categories)
      .innerJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(
        and(
          eq(categories.householdId, householdId),
          eq(categoryGroups.householdId, householdId),
        ),
      );

    const eligibleCategories = categoryRows.filter(
      (row) =>
        !row.categoryArchived &&
        !row.groupArchived &&
        row.includeInBudget &&
        row.groupType !== "transfers",
    );

    if (eligibleCategories.length === 0) {
      return { updated: 0, created: 0, cleared: 0 };
    }

    // Separate categories by group type (income vs expense)
    // NOTE: Schema uses "expenses" (plural) not "expense" (singular)
    const expenseCategories = eligibleCategories.filter(
      (row) => row.groupType === "expenses",
    );
    const incomeCategories = eligibleCategories.filter(
      (row) => row.groupType === "income",
    );

    const expenseCategoryIds = expenseCategories.map((row) => row.categoryId);
    const incomeCategoryIds = incomeCategories.map((row) => row.categoryId);

    // FIX DATA-BUDGET-001: Query expense transactions + splits for expense categories
    // 1. Regular transactions (those without splits)
    const expenseTotals =
      expenseCategoryIds.length > 0
        ? await db
            .select({
              categoryId: transactions.categoryId,
              total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.householdId, householdId),
                inArray(transactions.categoryId, expenseCategoryIds),
                eq(transactions.type, "expense"),
                eq(transactions.isExcludedFromBudget, false),
                isNull(transactions.deletedAt),
                gte(transactions.date, startDate),
                lte(transactions.date, endDate),
                sql`NOT EXISTS (
                  SELECT 1 FROM transaction_splits
                  WHERE transaction_splits.transaction_id = ${transactions.id}
                )`,
              ),
            )
            .groupBy(transactions.categoryId)
        : [];

    // 2. Transaction splits (for transactions that have splits)
    const expenseSplitTotals =
      expenseCategoryIds.length > 0
        ? await db
            .select({
              categoryId: transactionSplits.categoryId,
              total: sql<string>`COALESCE(SUM(${transactionSplits.amount}), 0)`,
            })
            .from(transactionSplits)
            .innerJoin(
              transactions,
              eq(transactionSplits.transactionId, transactions.id),
            )
            .where(
              and(
                eq(transactions.householdId, householdId),
                inArray(transactionSplits.categoryId, expenseCategoryIds),
                eq(transactions.type, "expense"),
                eq(transactions.isExcludedFromBudget, false),
                isNull(transactions.deletedAt),
                gte(transactions.date, startDate),
                lte(transactions.date, endDate),
              ),
            )
            .groupBy(transactionSplits.categoryId)
        : [];

    // Query income transactions + splits for income categories
    // 1. Regular transactions (those without splits)
    const incomeTotals =
      incomeCategoryIds.length > 0
        ? await db
            .select({
              categoryId: transactions.categoryId,
              total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.householdId, householdId),
                inArray(transactions.categoryId, incomeCategoryIds),
                eq(transactions.type, "income"),
                eq(transactions.isExcludedFromBudget, false),
                isNull(transactions.deletedAt),
                gte(transactions.date, startDate),
                lte(transactions.date, endDate),
                sql`NOT EXISTS (
                  SELECT 1 FROM transaction_splits
                  WHERE transaction_splits.transaction_id = ${transactions.id}
                )`,
              ),
            )
            .groupBy(transactions.categoryId)
        : [];

    // 2. Transaction splits (for transactions that have splits)
    const incomeSplitTotals =
      incomeCategoryIds.length > 0
        ? await db
            .select({
              categoryId: transactionSplits.categoryId,
              total: sql<string>`COALESCE(SUM(${transactionSplits.amount}), 0)`,
            })
            .from(transactionSplits)
            .innerJoin(
              transactions,
              eq(transactionSplits.transactionId, transactions.id),
            )
            .where(
              and(
                eq(transactions.householdId, householdId),
                inArray(transactionSplits.categoryId, incomeCategoryIds),
                eq(transactions.type, "income"),
                eq(transactions.isExcludedFromBudget, false),
                isNull(transactions.deletedAt),
                gte(transactions.date, startDate),
                lte(transactions.date, endDate),
              ),
            )
            .groupBy(transactionSplits.categoryId)
        : [];

    // Combine expense and income totals (regular + splits) using Money.from() for precision
    const totalsMap = new Map<string, Money>();

    // Add regular expense transactions
    for (const row of expenseTotals) {
      const categoryId = row.categoryId as string;
      const existing = totalsMap.get(categoryId) || Money.zero("ZMW");
      totalsMap.set(
        categoryId,
        existing.add(Money.from(row.total || "0", "ZMW")),
      );
    }

    // Add expense splits
    for (const row of expenseSplitTotals) {
      const categoryId = row.categoryId as string;
      const existing = totalsMap.get(categoryId) || Money.zero("ZMW");
      totalsMap.set(
        categoryId,
        existing.add(Money.from(row.total || "0", "ZMW")),
      );
    }

    // Add regular income transactions
    for (const row of incomeTotals) {
      const categoryId = row.categoryId as string;
      const existing = totalsMap.get(categoryId) || Money.zero("ZMW");
      totalsMap.set(
        categoryId,
        existing.add(Money.from(row.total || "0", "ZMW")),
      );
    }

    // Add income splits
    for (const row of incomeSplitTotals) {
      const categoryId = row.categoryId as string;
      const existing = totalsMap.get(categoryId) || Money.zero("ZMW");
      totalsMap.set(
        categoryId,
        existing.add(Money.from(row.total || "0", "ZMW")),
      );
    }

    const groupTotals = new Map<string, Money>();

    for (const row of eligibleCategories) {
      const total = totalsMap.get(row.categoryId) || Money.zero("ZMW");
      const groupId = row.groupId as string;
      const groupBudgetMode = row.groupBudgetMode || "by_category";

      if (groupBudgetMode === "by_group") {
        const current = groupTotals.get(groupId) || Money.zero("ZMW");
        groupTotals.set(groupId, current.add(total));
      }
    }

    const categoryBudgets = new Map<string, { name: string; amount: Money }>();

    for (const row of eligibleCategories) {
      const total = totalsMap.get(row.categoryId) || Money.zero("ZMW");
      const groupBudgetMode = row.groupBudgetMode || "by_category";

      if (groupBudgetMode === "by_group") {
        continue;
      }

      categoryBudgets.set(row.categoryId as string, {
        name: row.categoryName,
        amount: total,
      });
    }

    let updated = 0;
    let created = 0;
    let cleared = 0;

    // SCP-322: the delete + per-budget update/insert sequence must be atomic —
    // a mid-sequence failure previously left budgets in a corrupt partial state.
    await withTransaction(async (tx) => {
      // CONCURRENCY (CLAUDE.md Rule 10): serialize concurrent recalcs for this
      // household, and read the existing budgets INSIDE that serialization.
      //
      // The read below used to run outside this transaction on a separate
      // connection. Its result decides update-vs-insert per category, so two
      // concurrent recalcs (a double-clicked "recalculate", a retried request)
      // both read "no budget for category X" and both took the insert branch —
      // leaving TWO budget rows for one category. Every downstream read
      // (progress, forecast, reports) then picks one arbitrarily, and the
      // duplicate is invisible in the UI, which shows one row per category.
      //
      // NOTE — why the lock is on households, not on budgets: Postgres has no
      // gap/next-key locking, so FOR UPDATE on a budget row that does not exist
      // yet locks NOTHING and would not serialize the insert-vs-insert case that
      // is the actual bug. There is also no unique constraint on
      // (household_id, category_id) to collide on (adding one needs a
      // dedupe-first migration — out of scope here). So we take the household
      // row, which always exists, as the serialization anchor — the same pattern
      // household create/erase/accept-invite already use. Recalc is a rare,
      // heavy, whole-household operation, so a per-household lock costs nothing
      // in practice.
      await tx
        .select({ id: households.id })
        .from(households)
        .where(eq(households.id, householdId))
        .for("update")
        .limit(1);

      const existingBudgets = await tx
        .select()
        .from(budgets)
        .where(eq(budgets.householdId, householdId));

      const budgetsByCategory = new Map(
        existingBudgets
          .filter((budget) => budget.categoryId)
          .map((budget) => [budget.categoryId as string, budget]),
      );
      const budgetsByGroup = new Map(
        existingBudgets
          .filter((budget) => budget.categoryGroupId)
          .map((budget) => [budget.categoryGroupId as string, budget]),
      );

      const groupIds = Array.from(groupTotals.keys());
      if (groupIds.length > 0) {
        const categoryIdsToClear = eligibleCategories
          .filter((row) => row.groupBudgetMode === "by_group")
          .map((row) => row.categoryId);

        if (categoryIdsToClear.length > 0) {
          await tx
            .delete(budgets)
            .where(
              and(
                eq(budgets.householdId, householdId),
                inArray(budgets.categoryId, categoryIdsToClear),
              ),
            );
          cleared = categoryIdsToClear.length;
        }
      }

      for (const [categoryId, categoryBudget] of Array.from(
        categoryBudgets.entries(),
      )) {
        const existing = budgetsByCategory.get(categoryId);
        const amount = categoryBudget.amount.toString();

        if (existing) {
          await tx
            .update(budgets)
            .set({ amount, updatedAt: new Date() })
            .where(
              and(
                eq(budgets.id, existing.id),
                eq(budgets.householdId, householdId),
              ),
            );
          updated += 1;
        } else {
          await tx.insert(budgets).values({
            householdId,
            name: categoryBudget.name,
            categoryId,
            amount,
            period: "monthly",
          });
          created += 1;
        }
      }

      for (const [groupId, amountValue] of Array.from(groupTotals.entries())) {
        const group = eligibleCategories.find((row) => row.groupId === groupId);
        const groupName = group?.groupName || "Group Budget";
        const existing = budgetsByGroup.get(groupId);
        const amount = amountValue.toString();

        if (existing) {
          await tx
            .update(budgets)
            .set({ amount, updatedAt: new Date() })
            .where(
              and(
                eq(budgets.id, existing.id),
                eq(budgets.householdId, householdId),
              ),
            );
          updated += 1;
        } else {
          await tx.insert(budgets).values({
            householdId,
            name: groupName,
            categoryGroupId: groupId,
            amount,
            period: "monthly",
          });
          created += 1;
        }
      }
    });

    return { updated, created, cleared };
  }

  async clearBudgets(householdId: string): Promise<number> {
    const result = await db
      .delete(budgets)
      .where(
        and(
          eq(budgets.householdId, householdId),
          eq(budgets.isFlexBucket, false),
        ),
      )
      .returning({ id: budgets.id });
    return result.length;
  }
}
