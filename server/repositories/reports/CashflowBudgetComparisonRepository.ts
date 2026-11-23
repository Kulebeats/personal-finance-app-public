/**
 * Cashflow Budget Comparison Repository
 *
 * Handles budget vs actual comparison operations.
 * Split from CashflowReportRepository to keep file sizes under 500 LOC.
 *
 * @module repositories/reports/CashflowBudgetComparisonRepository
 */

import { db } from "../../db";
import { sql, eq, and, inArray, lte, gte } from "drizzle-orm";
import {
  transactions,
  categories,
  accounts,
  budgets,
  budgetPeriods,
  transactionSplits,
  providerFxQuotes,
  households,
  householdMembers,
} from "@shared/schema";
import { isCurrencyCode } from "@shared/denomination";
import { Money } from "../../core/money";
import { BudgetDenominationUnavailable, readBudgetMoney } from "../../core/money/budget-denomination";
import { ForbiddenError } from "../../core/errors";
import { readableMembershipPredicate, visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { can } from "../../core/authz/capabilities";
import { BaseReportRepository } from "./BaseReportRepository";
import { toMoneyDtoSafe } from "./moneyUtils";
import {
  compareBudgetsToActuals,
  getUnbudgetedCategories,
  type ComparisonBudgetInput,
  type ActualSpendingInput,
} from "../../core/calculations/cashflow";

class BudgetComparisonUnavailable extends BudgetDenominationUnavailable {
  constructor() { super(); this.message = "Verified posted expense allocations are unavailable for this budget comparison."; }
}
type ComparisonQuery = { from: string; to: string; interval: "day" | "week" | "month"; scope?: "household" | "mine"; userId?: string };
type ReadTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function readComparisonLimit(amount: string, sourceCurrency: string | null, currency: string): Money {
  if (!/^[0-9]+([.][0-9]{1,2})?$/.test(amount)) throw new BudgetComparisonUnavailable();
  const value = readBudgetMoney(amount, sourceCurrency, currency);
  if (!value.amount.isFinite() || value.gt(new Money("9999999999999.99", currency))) throw new BudgetComparisonUnavailable();
  return value;
}

/**
 * Repository for budget comparison operations
 */
export class CashflowBudgetComparisonRepository extends BaseReportRepository {
  protected override async getHouseholdCurrency(householdId: string, tx?: ReadTransaction): Promise<string> {
    const [household] = await (tx ?? db).select({ currency: households.currency }).from(households).where(eq(households.id, householdId));
    if (!isCurrencyCode(household?.currency)) throw new BudgetComparisonUnavailable();
    return household.currency;
  }
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
    query: ComparisonQuery,
  ) {
    // The renderer also reads defaults and period overrides. Keep every query
    // on this same coherent audience/source/rate/limit snapshot for JSON+CSV.
    return db.transaction(tx => this.readComparisonSnapshot(householdId, query, tx), {
      isolationLevel: "repeatable read", accessMode: "read only",
    });
  }

  private async readComparisonSnapshot(
    householdId: string,
    query: ComparisonQuery,
    tx: ReadTransaction,
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
    // Establish this snapshot's current audience before inspecting household
    // data. A withdrawn grant has the same denial for every currency state.
    if (!userId) throw new ForbiddenError("Budget comparison access denied");
    const [membership] = await tx.select({ role: householdMembers.role }).from(householdMembers).where(and(
      eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId),
    ));
    if (!membership || !can(membership.role, "financial.read") ||
      (scope === "household" && membership.role !== "owner" && membership.role !== "admin")) {
      throw new ForbiddenError("Budget comparison access denied");
    }
    const currency = await this.getHouseholdCurrency(householdId, tx);

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
    }, currency, tx);

    // Get budgets (in the household's currency, matching the actuals)
    const budgetList = await this.getBudgetsForComparison(householdId, currency, { from, to }, actuals.map(row => row.categoryId), tx);

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
    requestedCurrency?: string,
    tx?: ReadTransaction,
  ): Promise<ActualSpendingInput[]> {
    const { from, to, scope = "household", userId } = query;
    if (!userId) throw new ForbiddenError("Budget comparison access denied");
    const currency = requestedCurrency ?? await this.getHouseholdCurrency(householdId, tx);
    const actor = { householdId, userId, role: "member" as const };
    // Bind posted visibility, full-parent reconciliation, trusted dated FX and
    // totals to one snapshot. Invisible activity must not affect availability.
    // Production expenses carry positive amounts plus type. No stored refund
    // provenance authorizes ABS or income netting for malformed legacy rows.
    // Keep this report's category/exclusion scope, not budget-only settings.
    const result = await (tx ?? db).execute<{ allowed: boolean; invalid: boolean; entries: Array<{ categoryId: string; categoryName: string; amount: string }> }>(sql`
      WITH visible_parents AS (
        SELECT ${transactions.id} AS id, ${transactions.categoryId} AS category_id,
          ${transactions.amount} AS amount, ${transactions.currency} AS currency, ${transactions.date} AS date
        FROM ${transactions} JOIN ${accounts} ON ${accounts.id}=${transactions.accountId}
        WHERE ${visibleTransactionPredicate(actor)} AND ${transactions.type}='expense'
          AND ${transactions.isExcludedFromReports}=false AND ${transactions.isPending}=false
          AND ${transactions.status} IS DISTINCT FROM 'pending' AND ${transactions.date} BETWEEN ${from}::date AND ${to}::date
          AND ${scope === "mine" ? eq(transactions.ownerUserId, userId) : sql`true`}
      ), allocations AS (
        SELECT p.id AS parent_id,p.category_id,p.amount,p.amount AS parent_amount,p.currency,p.date FROM visible_parents p
        WHERE NOT EXISTS (SELECT 1 FROM ${transactionSplits} s WHERE s.transaction_id=p.id)
        UNION ALL
        SELECT p.id,s.category_id,s.amount,p.amount,p.currency,p.date FROM visible_parents p
          JOIN ${transactionSplits} s ON s.transaction_id=p.id
      ), eligible AS (
        SELECT a.parent_id,coalesce(c.id::text,'uncategorized') AS category_id,
          a.amount,a.parent_amount,a.currency,a.date,coalesce(c.name,'Uncategorized') AS category_name
        FROM allocations a LEFT JOIN ${categories} c ON c.id=a.category_id AND c.household_id=${householdId}::uuid
      ), invalid_splits AS (
        SELECT p.id FROM visible_parents p JOIN ${transactionSplits} s ON s.transaction_id=p.id
        WHERE EXISTS (SELECT 1 FROM eligible e WHERE e.parent_id=p.id)
        GROUP BY p.id,p.amount HAVING sum(s.amount) IS DISTINCT FROM p.amount
          OR bool_or(s.amount<0 OR s.amount::text !~ '^[0-9]+([.][0-9]+)?$')
      ), rated AS (
        SELECT e.*,CASE WHEN e.currency=${currency}::text THEN 1 ELSE (
          SELECT q.rate FROM ${providerFxQuotes} q WHERE q.from_currency=e.currency AND q.to_currency=${currency}::text
            AND q.effective_date<=e.date AND q.valid_through>=e.date AND q.quoted_at<=transaction_timestamp()
            AND q.provider IN ('yahoo_finance','exchangerate_api')
          ORDER BY q.effective_date DESC,q.quoted_at DESC,q.provider LIMIT 1
        ) END AS rate FROM eligible e WHERE e.amount<>0
      ), totals AS (
        SELECT category_id,category_name,sum(amount*rate) AS amount FROM rated GROUP BY category_id,category_name
        HAVING sum(amount*rate)>0
      ) SELECT ${readableMembershipPredicate(actor)} AS allowed,
        (SELECT currency FROM ${households} WHERE id=${householdId}::uuid) IS DISTINCT FROM ${currency}::text
        OR EXISTS (SELECT 1 FROM invalid_splits)
        OR EXISTS (SELECT 1 FROM eligible WHERE amount<0 OR parent_amount<0
          OR amount::text !~ '^[0-9]+([.][0-9]+)?$' OR parent_amount::text !~ '^[0-9]+([.][0-9]+)?$')
        OR EXISTS (SELECT 1 FROM rated WHERE currency IS NULL OR currency !~ '^[A-Z]{3}$' OR rate IS NULL
          OR rate<=0 OR rate::text !~ '^[0-9]+([.][0-9]+)?$') AS invalid,
        coalesce((SELECT jsonb_agg(jsonb_build_object('categoryId',category_id::text,'categoryName',category_name,'amount',amount::text)
          ORDER BY amount DESC,category_id) FROM totals),'[]'::jsonb) AS entries`);
    const row = result.rows[0];
    if (!row?.allowed) throw new ForbiddenError("Budget comparison access denied");
    if (row.invalid) throw new BudgetComparisonUnavailable();
    return row.entries.map(entry => ({ ...entry, amount: new Money(entry.amount, currency).toString(), currency, period: `${from}/${to}` }));
  }

  /**
   * Get budgets formatted for comparison
   */
  async getBudgetsForComparison(
    householdId: string,
    currency: string,
    window?: { from: string; to: string },
    actualCategoryIds?: string[],
    tx?: ReadTransaction,
  ): Promise<ComparisonBudgetInput[]> {
    // Synthetic buckets have no category UUID or persisted manual limit.
    const budgetCategoryIds = actualCategoryIds?.filter(id => id !== "uncategorized");
    if (budgetCategoryIds?.length === 0) return [];
    const reader = tx ?? db;
    const budgetData = await reader
      .select({
        id: budgets.id,
        categoryId: budgets.categoryId,
        categoryName: categories.name,
        amount: budgets.amount,
        currency: budgets.currency,
        period: budgets.period,
      })
      .from(budgets)
      .leftJoin(categories, eq(budgets.categoryId, categories.id))
      .where(and(eq(budgets.householdId, householdId), eq(budgets.isActive, true),
        budgetCategoryIds && inArray(budgets.categoryId, budgetCategoryIds)));

    const periods = window && budgetData.length ? await reader.select().from(budgetPeriods).where(and(
      inArray(budgetPeriods.budgetId, budgetData.map(row => row.id)),
      lte(budgetPeriods.startDate, window.to), gte(budgetPeriods.endDate, window.from),
    )) : [];
    const resolvedBudgets = budgetData.flatMap((b): ComparisonBudgetInput[] => {
      if (b.categoryId === null) return [];
      const overrides = periods.filter(row => row.budgetId === b.id);
      for (const override of overrides) {
        const start = `${override.startDate.slice(0, 7)}-01`, next = new Date(`${start}T00:00:00Z`);
        next.setUTCMonth(next.getUTCMonth() + 1);
        const end = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
        if (override.startDate !== start || override.endDate !== end) throw new BudgetComparisonUnavailable();
      }
      let periodAmount: string | undefined;
      if (window) {
        let total = Money.zero(currency), hasLimit = false;
        const cursor = new Date(`${window.from.slice(0, 7)}-01T00:00:00Z`), last = new Date(`${window.to}T00:00:00Z`);
        while (cursor <= last) {
          const first = cursor.toISOString().slice(0, 10), next = new Date(cursor);
          next.setUTCMonth(next.getUTCMonth() + 1);
          const end = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
          const override = overrides.find(row => row.startDate === first && row.endDate === end);
          const amount = override?.budgetAmount ?? b.amount;
          if (amount !== null) {
            const overlapFirst = first > window.from ? first : window.from, overlapLast = end < window.to ? end : window.to;
            const days = (new Date(`${overlapLast}T00:00:00Z`).getTime() - new Date(`${overlapFirst}T00:00:00Z`).getTime()) / 86400000 + 1;
            total = total.add(readComparisonLimit(amount, override?.currency ?? b.currency, currency).multiply(days).divide(new Date(`${end}T00:00:00Z`).getUTCDate()));
            hasLimit = true;
          }
          cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
        if (!hasLimit) return [];
        periodAmount = total.toString();
      }
      const resolved = periodAmount ?? (b.amount === null ? null : readComparisonLimit(b.amount, b.currency, currency).toString());
      if (resolved === null) return [];
      return [{
        categoryId: b.categoryId!,
        categoryName: b.categoryName || "Unknown",
        amount: resolved,
        ...(periodAmount !== undefined ? { periodAmount } : {}),
        currency,
        periodType: (b.period === "yearly" ? "yearly" : "monthly") as
          | "monthly"
          | "yearly",
      }];
    });
    const categoriesWithLimit = new Set<string>();
    for (const budget of resolvedBudgets) {
      if (categoriesWithLimit.has(budget.categoryId)) throw new BudgetComparisonUnavailable();
      categoriesWithLimit.add(budget.categoryId);
    }
    return resolvedBudgets;
  }
}

// Singleton instance
export const cashflowBudgetComparisonRepository =
  new CashflowBudgetComparisonRepository();
