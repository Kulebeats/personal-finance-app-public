/**
 * Cashflow Budget Comparison Repository
 *
 * Handles budget vs actual comparison operations.
 * Split from CashflowReportRepository to keep file sizes under 500 LOC.
 *
 * @module repositories/reports/CashflowBudgetComparisonRepository
 */

import { db } from "../../db";
import { sql, eq } from "drizzle-orm";
import {
  transactions,
  categories,
  accounts,
  budgets,
} from "@shared/schema";
import { Money } from "../../core/money";
import { BaseReportRepository } from "./BaseReportRepository";
import { toMoneyDtoSafe } from "./moneyUtils";
import {
  compareBudgetsToActuals,
  getUnbudgetedCategories,
  type ComparisonBudgetInput,
  type ActualSpendingInput,
} from "../../core/calculations/cashflow";

/**
 * Repository for budget comparison operations
 */
export class CashflowBudgetComparisonRepository extends BaseReportRepository {
  /**
   * Get budget vs actual spending comparison
   *
   * Compares actual spending by category against budgets.
   * Normalizes budget amounts to the requested interval.
   *
   * @param householdId - The household context
   * @param query - Budget comparison query params
   * @returns Comparison items with variance and summary stats
   */
  async getBudgetComparison(
    householdId: string,
    query: {
      from: string;
      to: string;
      interval: "day" | "week" | "month";
      scope?: "household" | "mine";
      userId?: string;
    },
  ): Promise<{
    comparison: Array<{
      period: string;
      categoryId: string;
      categoryName: string;
      actual: { amount: string; currency: string };
      budgeted: { amount: string; currency: string };
      variance: { amount: string; currency: string };
      variancePercent: number;
      status: "under" | "on_track" | "over" | "unbudgeted";
    }>;
    summary: {
      totalActual: { amount: string; currency: string };
      totalBudgeted: { amount: string; currency: string };
      totalVariance: { amount: string; currency: string };
      categoriesOverBudget: number;
      categoriesUnderBudget: number;
    };
    metadata: {
      budgetsCovered: number;
      categoriesWithoutBudget: string[];
      periodNormalization: "prorated" | "full";
    };
  }> {
    const { from, to, interval, scope = "household", userId } = query;
    const currency = await this.getHouseholdCurrency(householdId);

    // Calculate days in period for normalization
    const startDate = new Date(from);
    const endDate = new Date(to);
    const periodDays =
      Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;

    // Get actual spending by category
    const actuals = await this.getSpendingByCategory(householdId, {
      from,
      to,
      scope,
      userId,
    });

    // Get budgets (in the household's currency, matching the actuals)
    const budgetList = await this.getBudgetsForComparison(householdId, currency);

    // Run comparison calculation
    const { items, summary } = compareBudgetsToActuals(
      actuals,
      budgetList,
      interval,
      periodDays,
      currency,
    );

    const unbudgetedCategories = getUnbudgetedCategories(items);

    return {
      comparison: items.map((item) => ({
        period: item.period,
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        actual: toMoneyDtoSafe(item.actual, currency),
        budgeted: toMoneyDtoSafe(item.budgeted, currency),
        variance: toMoneyDtoSafe(item.variance, currency),
        variancePercent: Number(item.variancePercent.toFixed(2)),
        status: item.status,
      })),
      summary: {
        totalActual: toMoneyDtoSafe(summary.totalActual, currency),
        totalBudgeted: toMoneyDtoSafe(summary.totalBudgeted, currency),
        totalVariance: toMoneyDtoSafe(summary.totalVariance, currency),
        categoriesOverBudget: summary.categoriesOverBudget,
        categoriesUnderBudget: summary.categoriesUnderBudget,
      },
      metadata: {
        budgetsCovered: budgetList.length,
        categoriesWithoutBudget: unbudgetedCategories,
        periodNormalization: interval === "month" ? "full" : "prorated",
      },
    };
  }

  /**
   * Get spending by category for budget comparison
   */
  async getSpendingByCategory(
    householdId: string,
    query: {
      from: string;
      to: string;
      scope?: "household" | "mine";
      userId?: string;
    },
  ): Promise<ActualSpendingInput[]> {
    const { from, to, scope = "household", userId } = query;
    const currency = await this.getHouseholdCurrency(householdId);
    const currencyExpr = this.buildCurrencyExpr(currency);
    const fxRateExpr = this.buildFxRateExpr(
      currencyExpr,
      currency,
      sql`t.date`,
    );

    // SCP-321: fail closed before aggregating. The query below has no
    // pending or hide_transactions filter, so the guard covers both.
    await this.assertFxRatesAvailable(householdId, currency, {
      from,
      to,
      includePending: true,
      includeHiddenAccounts: true,
      scope,
      userId,
    });

    const result = await db.execute<{
      category_id: string | null;
      category_name: string | null;
      total: string | null;
    }>(sql`
      SELECT
        c.id as category_id,
        c.name as category_name,
        COALESCE(SUM(ABS(t.amount)::numeric * ${fxRateExpr}), 0) as total
      FROM ${transactions} t
      LEFT JOIN ${categories} c ON c.id = t.category_id
      LEFT JOIN ${accounts} a ON a.id = t.account_id
      WHERE t.household_id = ${householdId}::uuid
        AND t.deleted_at IS NULL
        AND t.is_excluded_from_reports = FALSE
        AND t.date >= ${from}::date
        AND t.date <= ${to}::date
        AND t.type = 'expense'
        ${scope === "mine" && userId ? sql`AND t.owner_user_id = ${userId}::uuid` : sql``}
        ${userId ? sql`AND (t.is_private = FALSE OR t.owner_user_id = ${userId}::uuid)` : sql``}
      GROUP BY c.id, c.name
      HAVING SUM(ABS(t.amount)::numeric * ${fxRateExpr}) > 0
      ORDER BY total DESC
    `);

    return (result.rows || [])
      .filter((row) => row.category_id !== null)
      .map((row) => ({
        categoryId: row.category_id!,
        categoryName: row.category_name || "Uncategorized",
        amount: new Money(String(row.total || "0"), currency).toString(),
        currency,
        period: `${from}/${to}`,
      }));
  }

  /**
   * Get budgets formatted for comparison
   */
  async getBudgetsForComparison(
    householdId: string,
    currency: string,
  ): Promise<ComparisonBudgetInput[]> {
    const budgetData = await db
      .select({
        id: budgets.id,
        categoryId: budgets.categoryId,
        categoryName: categories.name,
        amount: budgets.amount,
        period: budgets.period,
      })
      .from(budgets)
      .leftJoin(categories, eq(budgets.categoryId, categories.id))
      .where(eq(budgets.householdId, householdId));

    return budgetData
      .filter((b) => b.categoryId !== null)
      .map((b) => ({
        categoryId: b.categoryId!,
        categoryName: b.categoryName || "Unknown",
        amount: b.amount,
        currency, // Budgets use household currency
        periodType: (b.period === "yearly" ? "yearly" : "monthly") as
          | "monthly"
          | "yearly",
      }));
  }
}

// Singleton instance
export const cashflowBudgetComparisonRepository =
  new CashflowBudgetComparisonRepository();
