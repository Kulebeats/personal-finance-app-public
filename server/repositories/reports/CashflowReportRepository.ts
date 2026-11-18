/**
 * Cashflow Report Repository
 *
 * Handles cashflow-related analytics:
 * - getCashflow: income vs expenses over time
 * - getIncome: income report
 * - getSavingsRate: savings rate over time
 * - getExpenseClassification: fixed/variable/discretionary
 *
 * Forecast and budget comparison operations are in separate files.
 *
 * @module repositories/reports/CashflowReportRepository
 */

import { db } from "../../db";
import { sql } from "drizzle-orm";
import {
  transactions,
  transactionSplits,
  categories,
  accounts,
  investmentTransactions,
} from "@shared/schema";
import { Money } from "../../core/money";
import { BaseReportRepository } from "./BaseReportRepository";
import type {
  ReportsCashflowResponse,
  ReportsIncomeResponse,
  ReportsSavingsRateResponse,
} from "@shared/reports";
import type {
  ReportsCashflowQuery,
  ReportsIncomeQuery,
  ReportsSavingsRateQuery,
} from "../../modules/reports/reports.validation";
import type { QueryWithUser } from "./types";
import {
  moneyFromDto,
  moneyFromValue,
  percentOf,
  toMoneyDtoSafe,
} from "./moneyUtils";
import {
  generateForecast,
  toForecastSeriesPoint,
  type CategoryAverageInput,
} from "../../core/calculations/cashflow";

// Re-export split modules
export {
  getActiveRecurringRules,
  getBudgetsForHousehold,
} from "./CashflowForecastRepository";
export {
  CashflowBudgetComparisonRepository,
  cashflowBudgetComparisonRepository,
} from "./CashflowBudgetComparisonRepository";

// ISSUE-RPT-005 FIX: Define proper types for raw SQL query results
interface CategoryMonthlyRow {
  category_id: string | null;
  category_name: string | null;
  month: string;
  total: string | null;
}

/**
 * Repository for cashflow analytics.
 */
export class CashflowReportRepository extends BaseReportRepository {
  /**
   * Get cashflow (income vs expenses over time)
   */
  async getCashflow(
    householdId: string,
    query: QueryWithUser<ReportsCashflowQuery>,
  ): Promise<ReportsCashflowResponse> {
    const {
      from,
      to,
      interval = "month",
      includePending = false,
      includeTransfers = false,
      merchantId,
      timezone,
      scope = "household",
      userId,
    } = query;

    const currency = await this.getHouseholdCurrency(householdId);
    const merchantFilterId = merchantId ?? null;
    const timeZone = timezone || "UTC";

    // SCP-321: fail closed BEFORE aggregating — the SQL rate expression
    // silently converts at 1 when a rate row is missing.
    await this.assertFxRatesAvailable(householdId, currency, {
      from,
      to,
      includePending,
      scope,
      userId,
      // The orphaned investment-income query below also converts via FX.
      includeInvestmentIncome: merchantFilterId === null,
    });

    const truncInterval = interval === "week" ? "week" : interval;
    const periodExpr =
      timeZone === "UTC"
        ? sql`date_trunc(${truncInterval}::text, t.date)::date`
        : sql`date_trunc(${truncInterval}::text, (t.date::timestamp AT TIME ZONE ${timeZone}::text))::date`;

    const currencyExpr = sql`COALESCE(t.currency, a.currency, ${currency}::text)`;
    const fxRateExpr = this.buildFxRateExpr(currencyExpr, currency, sql`t.date`);

    const investmentPeriodExpr =
      timeZone === "UTC"
        ? sql`date_trunc(${truncInterval}::text, t.transaction_date)::date`
        : sql`date_trunc(${truncInterval}::text, (t.transaction_date::timestamp AT TIME ZONE ${timeZone}::text))::date`;
    const investmentCurrencyExpr = sql`COALESCE(t.currency, a.currency, ${currency}::text)`;
    const investmentFxRateExpr = this.buildFxRateExpr(
      investmentCurrencyExpr,
      currency,
      sql`t.transaction_date`,
    );

    const result = await db.execute<{
      period_start: string;
      income: string;
      expenses: string;
      debt: string;
    }>(sql`
      SELECT
        ${periodExpr} AS period_start,
        SUM(CASE
          WHEN t.type = 'income' THEN t.amount::numeric * ${fxRateExpr}
          WHEN ${includeTransfers}::boolean = TRUE
            AND t.type = 'transfer'
            AND t.is_transfer_in = TRUE
            AND a.type NOT IN ('credit', 'loan', 'mortgage', 'other_liability')
            THEN t.amount::numeric * ${fxRateExpr}
          ELSE 0
        END) AS income,
        SUM(CASE
          WHEN t.type = 'expense'
            AND a.type NOT IN ('credit', 'loan', 'mortgage', 'other_liability')
            THEN t.amount::numeric * ${fxRateExpr}
          WHEN ${includeTransfers}::boolean = TRUE
            AND t.type = 'transfer'
            AND t.is_transfer_in = FALSE
            AND a.type NOT IN ('credit', 'loan', 'mortgage', 'other_liability')
            THEN t.amount::numeric * ${fxRateExpr}
          ELSE 0
        END) AS expenses,
        SUM(CASE
          WHEN t.type = 'expense'
            AND a.type IN ('credit', 'loan', 'mortgage', 'other_liability')
            THEN t.amount::numeric * ${fxRateExpr}
          WHEN t.type = 'transfer'
            AND t.is_transfer_in = TRUE
            AND a.type IN ('credit', 'loan', 'mortgage', 'other_liability')
            THEN t.amount::numeric * ${fxRateExpr}
          ELSE 0
        END) AS debt
      FROM ${transactions} t
      JOIN ${accounts} a ON a.id = t.account_id
      WHERE t.household_id = ${householdId}::uuid
        AND t.deleted_at IS NULL
        AND t.is_excluded_from_reports = FALSE
        AND t.date >= ${from}::date
        AND t.date <= ${to}::date
        AND (${merchantFilterId}::uuid IS NULL OR t.merchant_id = ${merchantFilterId}::uuid)
        AND (${includePending}::boolean = TRUE OR t.is_pending = FALSE)
        AND (${includeTransfers}::boolean = TRUE OR t.type NOT IN ('transfer', 'balance_adjustment'))
        AND (${scope}::text = 'household' OR t.owner_user_id = ${userId}::uuid)
        AND (t.is_private = FALSE OR t.owner_user_id = ${userId}::uuid)
        AND (a.is_private = FALSE OR a.owner_user_id = ${userId}::uuid)
        AND (a.hide_transactions = FALSE OR a.hide_transactions IS NULL)
      GROUP BY 1
      ORDER BY 1
    `);

    const regularRows = result.rows || [];

    // Query for orphaned investment income
    const orphanRows =
      merchantFilterId !== null
        ? []
        : (
            await db.execute<{
              period_start: string;
              income: string;
            }>(sql`
              SELECT
                ${investmentPeriodExpr} AS period_start,
                SUM(t.amount::numeric * ${investmentFxRateExpr}) AS income
              FROM ${investmentTransactions} t
              JOIN ${accounts} a ON a.id = t.account_id
              WHERE t.household_id = ${householdId}::uuid
                AND t.linked_transaction_id IS NULL
                AND t.type IN ('dividend', 'interest', 'coupon')
                AND t.transaction_date >= ${from}::date
                AND t.transaction_date <= ${to}::date
                AND a.deleted_at IS NULL
                AND (a.is_private = FALSE OR a.owner_user_id = ${userId}::uuid)
            GROUP BY 1
          `)
          ).rows || [];

    // Merge data sources
    const dataByPeriod = new Map<
      string,
      { income: Money; expenses: Money; debt: Money }
    >();

    const zero = Money.zero(currency);

    for (const row of regularRows) {
      const key = new Date(row.period_start).toISOString().split("T")[0];
      const current = dataByPeriod.get(key) || { income: zero, expenses: zero, debt: zero };
      current.income = current.income.add(moneyFromValue(row.income, currency));
      current.expenses = current.expenses.add(moneyFromValue(row.expenses, currency));
      current.debt = current.debt.add(moneyFromValue(row.debt, currency));
      dataByPeriod.set(key, current);
    }

    for (const row of orphanRows) {
      const key = new Date(row.period_start).toISOString().split("T")[0];
      const current = dataByPeriod.get(key) || { income: zero, expenses: zero, debt: zero };
      current.income = current.income.add(moneyFromValue(row.income, currency));
      dataByPeriod.set(key, current);
    }

    // Build series with all periods in range
    const series: ReportsCashflowResponse["series"] = [];
    const curr = new Date(from);
    const end = new Date(to);
    const toMoneyValue = (value: Money) => toMoneyDtoSafe(value, currency);
    const totals = {
      income: Money.zero(currency),
      expenses: Money.zero(currency),
      savings: Money.zero(currency),
      debt: Money.zero(currency),
      savingsRate: 0,
    };

    while (curr <= end) {
      const key = curr.toISOString().split("T")[0];
      const data = dataByPeriod.get(key) || { income: zero, expenses: zero, debt: zero };

      const savings = data.income.subtract(data.expenses.add(data.debt));
      const savingsRateVal = percentOf(savings, data.income, 2);

      series.push({
        periodStart: key,
        periodEnd: key,
        label: curr.toLocaleDateString("en-US", {
          month: "short",
          year: interval === "month" ? "numeric" : undefined,
        }),
        income: toMoneyValue(data.income),
        expenses: toMoneyValue(data.expenses),
        savings: toMoneyValue(savings),
        savingsRate: savingsRateVal,
        debt: toMoneyValue(data.debt),
      });

      totals.income = totals.income.add(data.income);
      totals.expenses = totals.expenses.add(data.expenses);
      totals.savings = totals.savings.add(savings);
      totals.debt = totals.debt.add(data.debt);
      totals.savingsRate = percentOf(totals.savings, totals.income, 2);

      if (interval === "month") {
        curr.setMonth(curr.getMonth() + 1);
      } else if (interval === "week") {
        curr.setDate(curr.getDate() + 7);
      } else {
        curr.setDate(curr.getDate() + 1);
      }
    }

    // Detect if mixed currencies are present
    const currencyCheckResult = await db.execute<{ has_foreign_currency: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM ${transactions} t
        JOIN ${accounts} a ON a.id = t.account_id
        WHERE t.household_id = ${householdId}::uuid
          AND t.deleted_at IS NULL
          AND t.is_excluded_from_reports = FALSE
          AND t.date >= ${from}::date
          AND t.date <= ${to}::date
          AND (${merchantFilterId}::uuid IS NULL OR t.merchant_id = ${merchantFilterId}::uuid)
          AND (${includePending}::boolean = TRUE OR t.is_pending = FALSE)
          AND (${includeTransfers}::boolean = TRUE OR t.type NOT IN ('transfer', 'balance_adjustment'))
          AND (${scope}::text = 'household' OR t.owner_user_id = ${userId}::uuid)
          AND (t.is_private = FALSE OR t.owner_user_id = ${userId}::uuid)
          AND (a.is_private = FALSE OR a.owner_user_id = ${userId}::uuid)
          AND (a.hide_transactions = FALSE OR a.hide_transactions IS NULL)
          AND COALESCE(t.currency, a.currency) IS NOT NULL
          AND COALESCE(t.currency, a.currency) != ${currency}::text
      ) as has_foreign_currency
    `);

    const hasForeignCurrency = currencyCheckResult.rows?.[0]?.has_foreign_currency ?? false;

    return {
      range: { from, to, interval, baseCurrency: currency },
      series,
      totals: {
        income: toMoneyValue(totals.income),
        expenses: toMoneyValue(totals.expenses),
        savings: toMoneyValue(totals.savings),
        debt: toMoneyValue(totals.debt),
        savingsRate: totals.savingsRate,
      },
      metadata: {
        currencyMode: hasForeignCurrency ? "mixed" : "household",
        baseCurrency: currency,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Get income report
   */
  async getIncome(
    householdId: string,
    query: QueryWithUser<ReportsIncomeQuery>,
  ): Promise<ReportsIncomeResponse> {
    const cashflow = await this.getCashflow(householdId, query);

    return {
      range: cashflow.range,
      series: cashflow.series.map((s) => ({
        label: s.label,
        income: s.income,
        expenses: s.expenses,
        net: s.savings,
      })),
      totals: {
        income: cashflow.totals.income,
        expenses: cashflow.totals.expenses,
        net: cashflow.totals.savings,
      },
    };
  }

  /**
   * Get savings rate over time
   */
  async getSavingsRate(
    householdId: string,
    query: QueryWithUser<ReportsSavingsRateQuery>,
  ): Promise<ReportsSavingsRateResponse> {
    const cashflow = await this.getCashflow(householdId, {
      ...query,
      interval: query.interval || "month",
    });

    return {
      range: {
        ...cashflow.range,
        interval: (query.interval || "month") as "week" | "month",
      },
      series: cashflow.series.map((s) => ({
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        label: s.label,
        savingsRate: s.savingsRate,
        income: s.income,
        expenses: s.expenses,
        savings: s.savings,
      })),
    };
  }

  /**
   * Get expense classification (fixed vs variable vs discretionary)
   */
  async getExpenseClassification(
    householdId: string,
    query: { from: string; to: string; scope?: string; userId?: string },
  ) {
    const { from, to, scope = "household", userId } = query;
    const currency = await this.getHouseholdCurrency(householdId);
    const currencyExpr = this.buildCurrencyExpr(currency);
    const fxRateExpr = this.buildFxRateExpr(currencyExpr, currency, sql`t.date`);

    // SCP-321: fail closed before aggregating. The monthly query below has
    // no pending or hide_transactions filter, so the guard covers both.
    await this.assertFxRatesAvailable(householdId, currency, {
      from,
      to,
      includePending: true,
      includeHiddenAccounts: true,
      scope,
      userId,
    });

    // Import SpendingReportRepository to get breakdown
    const { SpendingReportRepository } = await import("./SpendingReportRepository");
    const spendingRepo = new SpendingReportRepository();

    const breakdown = await spendingRepo.getSpendingBreakdown(householdId, {
      from,
      to,
      groupBy: "category",
      type: "expense",
      scope: scope as "household" | "mine",
      userId,
    });

    // Get monthly amounts per category
    const monthlyQuery = await db.execute(sql`
      SELECT
        c.id as category_id,
        c.name as category_name,
        DATE_TRUNC('month', t.date) as month,
        COALESCE(SUM(ABS(COALESCE(ts.amount, t.amount))::numeric * ${fxRateExpr}), 0) as total
      FROM ${transactions} t
      LEFT JOIN ${transactionSplits} ts ON ts.transaction_id = t.id
      LEFT JOIN ${categories} c ON c.id = COALESCE(ts.category_id, t.category_id)
      LEFT JOIN ${accounts} a ON a.id = t.account_id
      WHERE t.household_id = ${householdId}::uuid
        AND t.deleted_at IS NULL
        AND t.is_excluded_from_reports = FALSE
        AND t.date >= ${from}::date
        AND t.date <= ${to}::date
        AND t.type = 'expense'
        ${scope === "mine" && userId ? sql`AND t.owner_user_id = ${userId}::uuid` : sql``}
      GROUP BY c.id, c.name, DATE_TRUNC('month', t.date)
      ORDER BY c.id, month
    `);

    // REPORTS-MONEY-001 FIX: Build monthly amounts for classification algorithm
    // Note: classifyExpense needs numeric values for statistical analysis (CV calculation)
    // but we use Money.toNumber() safely here as it's for variance analysis, not display
    const categoryMonthlyAmounts = new Map<string, number[]>();
    for (const row of monthlyQuery.rows as unknown as CategoryMonthlyRow[]) {
      const catId = row.category_id || "uncategorized";
      const amounts = categoryMonthlyAmounts.get(catId) || [];
      try {
        // Parse as Money first to ensure proper decimal handling, then convert for stats
        const moneyValue = moneyFromValue(row.total, currency);
        amounts.push(moneyValue.toNumber());
      } catch {
        amounts.push(0);
      }
      categoryMonthlyAmounts.set(catId, amounts);
    }

    const { classifyExpense } = await import("../../utils/forecasting");

    const classification = {
      fixed: {
        amount: Money.zero(currency),
        percent: 0,
        categories: [] as Array<{ id: string; name: string; amount: Money }>,
      },
      variable: {
        amount: Money.zero(currency),
        percent: 0,
        categories: [] as Array<{ id: string; name: string; amount: Money }>,
      },
      discretionary: {
        amount: Money.zero(currency),
        percent: 0,
        categories: [] as Array<{ id: string; name: string; amount: Money }>,
      },
    };

    for (const item of breakdown.items) {
      const amounts = categoryMonthlyAmounts.get(item.entityId) || [];
      const type = classifyExpense(amounts);

      const itemValue = moneyFromDto(item.value, currency);
      classification[type].amount = classification[type].amount.add(itemValue);
      classification[type].categories.push({
        id: item.entityId,
        name: item.label,
        amount: itemValue,
      });
    }

    const total = classification.fixed.amount
      .add(classification.variable.amount)
      .add(classification.discretionary.amount);

    const totalCategories =
      classification.fixed.categories.length +
      classification.variable.categories.length +
      classification.discretionary.categories.length;

    const toMoneyValue = (value: Money) => toMoneyDtoSafe(value, currency);

    return {
      range: { from, to, currency },
      total: toMoneyValue(total),
      classification: {
        fixed: {
          amount: toMoneyValue(classification.fixed.amount),
          percent: percentOf(classification.fixed.amount, total, 2),
          categories: classification.fixed.categories.map((c) => ({
            ...c,
            amount: toMoneyValue(c.amount),
          })),
        },
        variable: {
          amount: toMoneyValue(classification.variable.amount),
          percent: percentOf(classification.variable.amount, total, 2),
          categories: classification.variable.categories.map((c) => ({
            ...c,
            amount: toMoneyValue(c.amount),
          })),
        },
        discretionary: {
          amount: toMoneyValue(classification.discretionary.amount),
          percent: percentOf(classification.discretionary.amount, total, 2),
          categories: classification.discretionary.categories.map((c) => ({
            ...c,
            amount: toMoneyValue(c.amount),
          })),
        },
      },
      accuracy: {
        score: 100,
        totalCategories,
        highConfidenceCount: totalCategories,
        threshold: 0.8,
      },
    };
  }

  /**
   * Get cashflow with optional forecast
   */
  async getCashflowWithForecast(
    householdId: string,
    query: QueryWithUser<ReportsCashflowQuery>,
  ): Promise<ReportsCashflowResponse> {
    const actuals = await this.getCashflow(householdId, query);

    if (!query.includeForecast || query.interval !== "month") {
      return actuals;
    }

    const currency = actuals.range.baseCurrency;
    const forecastMonths = query.forecastMonths ?? 3;

    const toDate = new Date(query.to + "T00:00:00Z");
    const forecastStart = new Date(toDate);
    forecastStart.setUTCMonth(forecastStart.getUTCMonth() + 1);
    forecastStart.setUTCDate(1);
    const forecastStartStr = forecastStart.toISOString().split("T")[0];

    const { getActiveRecurringRules, getBudgetsForHousehold } = await import(
      "./CashflowForecastRepository"
    );

    const [recurringRules, budgetData, categoryAverages] = await Promise.all([
      getActiveRecurringRules(householdId, currency),
      getBudgetsForHousehold(householdId),
      this.getCategoryAverages(householdId, query.from, query.to, query.userId),
    ]);

    const forecast = generateForecast(
      {
        horizonMonths: forecastMonths,
        baseCurrency: currency,
        startDate: forecastStartStr,
      },
      recurringRules,
      budgetData,
      categoryAverages,
    );

    const forecastSeries = forecast.points.map((p) =>
      toForecastSeriesPoint(p, currency),
    );

    return {
      ...actuals,
      series: [...actuals.series, ...forecastSeries],
      metadata: {
        currencyMode: actuals.metadata?.currencyMode ?? "household",
        baseCurrency: currency,
        generatedAt: new Date().toISOString(),
        forecastConfig: {
          enabled: true,
          horizonMonths: forecastMonths,
          dataSourcesUsed: forecast.dataSourcesUsed,
        },
      },
    };
  }

  /**
   * Get category averages for fallback forecast
   */
  private async getCategoryAverages(
    householdId: string,
    from: string,
    to: string,
    userId?: string,
  ): Promise<CategoryAverageInput[]> {
    const currency = await this.getHouseholdCurrency(householdId);
    const currencyExpr = this.buildCurrencyExpr(currency);
    const fxRateExpr = this.buildFxRateExpr(currencyExpr, currency, sql`t.date`);

    // SCP-321: fail closed before aggregating (query includes pending rows
    // and hidden accounts).
    await this.assertFxRatesAvailable(householdId, currency, {
      from,
      to,
      includePending: true,
      includeHiddenAccounts: true,
      userId,
    });

    const startDate = new Date(from);
    const endDate = new Date(to);
    const monthsDiff =
      (endDate.getFullYear() - startDate.getFullYear()) * 12 +
      (endDate.getMonth() - startDate.getMonth()) +
      1;
    const monthCount = Math.max(monthsDiff, 1);

    const result = await db.execute<{
      category_id: string | null;
      category_name: string | null;
      type: string;
      total: string | null;
    }>(sql`
      SELECT
        c.id as category_id,
        c.name as category_name,
        t.type,
        SUM(ABS(t.amount)::numeric * ${fxRateExpr}) as total
      FROM ${transactions} t
      LEFT JOIN ${categories} c ON c.id = t.category_id
      LEFT JOIN ${accounts} a ON a.id = t.account_id
      WHERE t.household_id = ${householdId}::uuid
        AND t.deleted_at IS NULL
        AND t.is_excluded_from_reports = FALSE
        AND t.date >= ${from}::date
        AND t.date <= ${to}::date
        AND t.type IN ('income', 'expense')
        ${userId ? sql`AND (t.is_private = FALSE OR t.owner_user_id = ${userId}::uuid)` : sql``}
      GROUP BY c.id, c.name, t.type
    `);

    return (result.rows || [])
      .filter((row) => row.category_id !== null)
      .map((row) => {
        const total = new Money(String(row.total || "0"), currency);
        const monthlyAvg = total.divide(monthCount);

        return {
          categoryId: row.category_id!,
          categoryName: row.category_name || "Unknown",
          type: row.type as "income" | "expense",
          monthlyAverage: monthlyAvg.toString(),
          currency,
        };
      });
  }

  /**
   * Get budget vs actual spending comparison
   * @deprecated Use cashflowBudgetComparisonRepository.getBudgetComparison instead
   */
  async getBudgetComparison(
    ...args: Parameters<
      import("./CashflowBudgetComparisonRepository").CashflowBudgetComparisonRepository["getBudgetComparison"]
    >
  ) {
    const { cashflowBudgetComparisonRepository } = await import(
      "./CashflowBudgetComparisonRepository"
    );
    return cashflowBudgetComparisonRepository.getBudgetComparison(...args);
  }
}

// Singleton instance
export const cashflowReportRepository = new CashflowReportRepository();
