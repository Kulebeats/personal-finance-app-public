// Modular report repositories
import {
  spendingReportRepository,
  cashflowReportRepository,
  netWorthReportRepository,
  transactionReportRepository,
  compositeReportRepository,
  analyticsReportRepository,
} from "../repositories/reports";
import { analyticsCache } from "./AnalyticsCache";
import {
  validateDateRange,
  validateLimit,
  validateMaxNodes,
} from "../modules/reports/reports.validation";
import type {
  CustomChartQueryConfig,
  ReportsCashflowResponse,
  ReportsSpendingBreakdownResponse,
  ReportsNetWorthResponse,
  ReportsIncomeResponse,
  ReportsSavingsRateResponse,
  ReportsSpendingTrendResponse,
  ReportsAnnualResponse,
  ReportsSankeyResponse,
  ReportsTransactionsResponse,
} from "@shared/reports";
import type {
  ReportsCashflowQuery,
  ReportsBudgetComparisonQuery,
  ReportsSpendingBreakdownQuery,
  ReportsNetWorthQuery,
  ReportsIncomeQuery,
  ReportsSavingsRateQuery,
  ReportsSpendingTrendQuery,
  ReportsAnnualQuery,
  ReportsSankeyQuery,
  ReportsTransactionsQuery,
} from "../modules/reports/reports.validation";

/**
 * AnalyticsService
 *
 * Business logic layer for analytics endpoints.
 * Responsibilities:
 * - Validate hard caps (date range, limits)
 * - Cache coordination (via AnalyticsCache)
 * - Delegate to modular report repositories
 * - Format responses
 */
export class AnalyticsService {
  /**
   * Get spending breakdown by category, merchant, or tag
   */
  async getSpendingBreakdown(
    householdId: string,
    userId: string,
    query: ReportsSpendingBreakdownQuery,
  ): Promise<ReportsSpendingBreakdownResponse> {
    validateDateRange(query.from, query.to);
    const limit = validateLimit(query.limit);

    return analyticsCache.getOrCompute(
      "spendingBreakdown",
      householdId,
      { ...query, userId },
      () =>
        spendingReportRepository.getSpendingBreakdown(householdId, {
          ...query,
          limit,
          userId,
        }),
    );
  }

  /**
   * Get cashflow (income vs expenses over time)
   * Supports optional forecast when includeForecast=true and interval=month
   */
  async getCashflow(
    householdId: string,
    userId: string,
    query: ReportsCashflowQuery,
  ): Promise<ReportsCashflowResponse> {
    validateDateRange(query.from, query.to);

    // Use forecast method if requested
    const repoMethod = query.includeForecast
      ? cashflowReportRepository.getCashflowWithForecast.bind(cashflowReportRepository)
      : cashflowReportRepository.getCashflow.bind(cashflowReportRepository);

    return analyticsCache.getOrCompute(
      "cashflow",
      householdId,
      { ...query, userId },
      () => repoMethod(householdId, { ...query, userId }),
    );
  }

  /**
   * Get net worth history
   */
  async getNetWorth(
    householdId: string,
    userId: string,
    query: ReportsNetWorthQuery,
  ): Promise<ReportsNetWorthResponse> {
    validateDateRange(query.from, query.to);

    return analyticsCache.getOrCompute(
      "netWorth",
      householdId,
      { ...query, userId },
      () =>
        netWorthReportRepository.getNetWorth(householdId, { ...query, userId }),
    );
  }

  /**
   * Get income report
   */
  async getIncome(
    householdId: string,
    userId: string,
    query: ReportsIncomeQuery,
  ): Promise<ReportsIncomeResponse> {
    validateDateRange(query.from, query.to);

    return analyticsCache.getOrCompute(
      "income",
      householdId,
      { ...query, userId },
      () =>
        cashflowReportRepository.getIncome(householdId, { ...query, userId }),
    );
  }

  /**
   * Get savings rate over time
   */
  async getSavingsRate(
    householdId: string,
    userId: string,
    query: ReportsSavingsRateQuery,
  ): Promise<ReportsSavingsRateResponse> {
    validateDateRange(query.from, query.to);

    return analyticsCache.getOrCompute(
      "savingsRate",
      householdId,
      { ...query, userId },
      () =>
        cashflowReportRepository.getSavingsRate(householdId, {
          ...query,
          userId,
        }),
    );
  }

  /**
   * Get budget vs actual spending comparison
   */
  async getBudgetComparison(
    householdId: string,
    userId: string,
    query: ReportsBudgetComparisonQuery,
  ) {
    validateDateRange(query.from, query.to);

    return analyticsCache.getOrCompute(
      "budgetComparison",
      householdId,
      { ...query, userId },
      () =>
        cashflowReportRepository.getBudgetComparison(householdId, {
          from: query.from,
          to: query.to,
          interval: query.interval ?? "month",
          scope: query.scope,
          userId,
        }),
    );
  }

  /**
   * Get spending trend with comparison
   */
  async getSpendingTrend(
    householdId: string,
    userId: string,
    query: ReportsSpendingTrendQuery,
  ): Promise<ReportsSpendingTrendResponse> {
    validateDateRange(query.from, query.to);

    return analyticsCache.getOrCompute(
      "spendingTrend",
      householdId,
      { ...query, userId },
      () =>
        spendingReportRepository.getSpendingTrend(householdId, {
          ...query,
          userId,
        }),
    );
  }

  /**
   * Get annual report
   */
  async getAnnual(
    householdId: string,
    userId: string,
    query: ReportsAnnualQuery,
  ): Promise<ReportsAnnualResponse> {
    return analyticsCache.getOrCompute(
      "annual",
      householdId,
      { ...query, userId },
      () =>
        compositeReportRepository.getAnnualReport(householdId, {
          ...query,
          userId,
        }),
    );
  }

  /**
   * Get Sankey diagram data
   */
  async getSankey(
    householdId: string,
    userId: string,
    query: ReportsSankeyQuery,
  ): Promise<ReportsSankeyResponse> {
    validateDateRange(query.from, query.to);
    const maxNodes = validateMaxNodes(query.maxNodes);

    return analyticsCache.getOrCompute(
      "sankey",
      householdId,
      { ...query, userId },
      () =>
        compositeReportRepository.getSankey(householdId, {
          ...query,
          maxNodes,
          userId,
        }),
    );
  }

  /**
   * Get transactions drilldown with pagination
   */
  async getTransactions(
    householdId: string,
    userId: string,
    query: ReportsTransactionsQuery,
  ): Promise<ReportsTransactionsResponse> {
    validateDateRange(query.from, query.to);
    const limit = validateLimit(query.limit);

    return analyticsCache.getOrCompute(
      "transactions",
      householdId,
      { ...query, userId },
      () =>
        transactionReportRepository.getTransactions(householdId, {
          ...query,
          limit,
          userId,
        }),
    );
  }

  // ==========================================================================
  // NEW: Annual Dashboard Methods (Section 9 of Requirements)
  // ==========================================================================

  /**
   * Get financial ratios (DTI, emergency fund, liquidity, burn rate)
   */
  async getFinancialRatios(
    householdId: string,
    userId: string,
    query: { from: string; to: string; scope?: string },
  ) {
    validateDateRange(query.from, query.to);
    return analyticsCache.getOrCompute(
      "financialRatios",
      householdId,
      { ...query, userId },
      () =>
        analyticsReportRepository.getFinancialRatios(householdId, {
          ...query,
          userId,
        }),
    );
  }

  /**
   * Get debt analysis (total debt, by type, payment trend)
   */
  async getDebtAnalysis(
    householdId: string,
    userId: string,
    query: { from: string; to: string; scope?: string },
  ) {
    validateDateRange(query.from, query.to);
    return analyticsCache.getOrCompute(
      "debtAnalysis",
      householdId,
      { ...query, userId },
      () =>
        analyticsReportRepository.getDebtAnalysis(householdId, {
          ...query,
          userId,
        }),
    );
  }

  /**
   * Get net worth changes over time
   */
  async getNetWorthChanges(
    householdId: string,
    userId: string,
    query: { from: string; to: string; scope?: string },
  ) {
    validateDateRange(query.from, query.to);
    return analyticsCache.getOrCompute(
      "netWorthChanges",
      householdId,
      { ...query, userId },
      () =>
        netWorthReportRepository.getNetWorthChanges(householdId, {
          ...query,
          userId,
        }),
    );
  }

  /**
   * Get expense classification (fixed vs variable vs discretionary)
   */
  async getExpenseClassification(
    householdId: string,
    userId: string,
    query: { from: string; to: string; scope?: string },
  ) {
    validateDateRange(query.from, query.to);
    return analyticsCache.getOrCompute(
      "expenseClassification",
      householdId,
      { ...query, userId },
      () =>
        cashflowReportRepository.getExpenseClassification(householdId, {
          ...query,
          userId,
        }),
    );
  }

  /**
   * Get goals progress
   */
  async getGoalsProgress(
    householdId: string,
    userId: string,
    query: { year?: number; scope?: string },
  ) {
    return analyticsCache.getOrCompute(
      "goalsProgress",
      householdId,
      // Retire reports with the old payoff percentage, units and monthly requirement.
      // Keep the viewer in the key and use the existing endpoint invalidation.
      { ...query, userId, shape: "viewer-paydown-progress" },
      () =>
        analyticsReportRepository.getGoalsProgress(householdId, {
          ...query,
          userId,
        }),
    );
  }

  /**
   * Get subcategory breakdown
   */
  async getSubcategoryBreakdown(
    householdId: string,
    userId: string,
    query: {
      from: string;
      to: string;
      type?: string;
      categoryId?: string;
      scope?: string;
    },
  ) {
    validateDateRange(query.from, query.to);
    return analyticsCache.getOrCompute(
      "subcategoryBreakdown",
      householdId,
      { ...query, userId },
      () =>
        spendingReportRepository.getSubcategoryBreakdown(householdId, {
          ...query,
          userId,
        }),
    );
  }

  /**
   * Get forecast projections
   */
  async getForecast(
    householdId: string,
    userId: string,
    query: {
      metric: string;
      projectionMonths: number;
      baselineMonths?: number;
      confidenceLevel?: number;
      scope?: string;
    },
  ) {
    return analyticsCache.getOrCompute(
      "forecast",
      householdId,
      { ...query, userId },
      () =>
        analyticsReportRepository.getForecast(householdId, {
          ...query,
          userId,
        }),
    );
  }

  /**
   * Execute custom chart query
   */
  async executeCustomChart(
    householdId: string,
    userId: string,
    body: {
      config: CustomChartQueryConfig;
      from: string;
      to: string;
      scope?: string;
    },
  ) {
    validateDateRange(body.from, body.to);
    return analyticsCache.getOrCompute(
      "customChart",
      householdId,
      { ...body, userId },
      () =>
        analyticsReportRepository.executeCustomChart(householdId, {
          ...body,
          userId,
        }),
    );
  }
}

export const analyticsService = new AnalyticsService();
