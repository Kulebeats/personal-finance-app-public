/**
 * Reports Module - Service Layer
 *
 * Delegates to AnalyticsService (single cache layer via AnalyticsCache).
 *
 * @module modules/reports/service
 */

import { analyticsService } from "../../services/AnalyticsService";

/**
 * Reports Service
 *
 * Delegates to AnalyticsService (single cache layer via AnalyticsCache).
 */
class ReportsService {
  /**
   * Get spending breakdown
   */
  getSpendingBreakdown = analyticsService.getSpendingBreakdown.bind(
    analyticsService
  );

  /**
   * Get net worth
   */
  getNetWorth = analyticsService.getNetWorth.bind(analyticsService);

  /**
   * Get annual report
   */
  getAnnual = analyticsService.getAnnual.bind(analyticsService);

  /**
   * Get cashflow
   */
  getCashflow = analyticsService.getCashflow.bind(analyticsService);

  /**
   * Get sankey diagram
   */
  getSankey = analyticsService.getSankey.bind(analyticsService);

  /**
   * Get savings rate
   */
  getSavingsRate = analyticsService.getSavingsRate.bind(analyticsService);

  /**
   * Get budget vs actual comparison
   */
  getBudgetComparison = analyticsService.getBudgetComparison.bind(analyticsService);

  /**
   * Get spending trend
   */
  getSpendingTrend = analyticsService.getSpendingTrend.bind(analyticsService);

  /**
   * Get income report
   */
  getIncome = analyticsService.getIncome.bind(analyticsService);

  /**
   * Get net worth changes
   */
  getNetWorthChanges =
    analyticsService.getNetWorthChanges.bind(analyticsService);

  /**
   * Get financial ratios
   */
  getFinancialRatios =
    analyticsService.getFinancialRatios.bind(analyticsService);

  /**
   * Get debt analysis
   */
  getDebtAnalysis = analyticsService.getDebtAnalysis.bind(analyticsService);

  /**
   * Get forecast
   */
  getForecast = analyticsService.getForecast.bind(analyticsService);

  /**
   * Get transactions drilldown
   */
  getTransactions = analyticsService.getTransactions.bind(analyticsService);

  /**
   * Get expense classification
   */
  getExpenseClassification =
    analyticsService.getExpenseClassification.bind(analyticsService);

  /**
   * Get goals progress
   */
  getGoalsProgress = analyticsService.getGoalsProgress.bind(analyticsService);

  /**
   * Get subcategory breakdown
   */
  getSubcategoryBreakdown =
    analyticsService.getSubcategoryBreakdown.bind(analyticsService);

  /**
   * Execute custom chart query
   */
  executeCustomChart = analyticsService.executeCustomChart.bind(
    analyticsService
  );
}

export const reportsService = new ReportsService();
