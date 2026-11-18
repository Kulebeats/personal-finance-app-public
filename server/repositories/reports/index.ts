/**
 * Report Repositories - Facade Export
 *
 * Provides modular access to report repositories.
 *
 * ARCHITECTURE:
 * - BaseReportRepository: Shared utilities (currency, FX, filters)
 * - SpendingReportRepository: getSpendingBreakdown, getSpendingTrend, getSubcategoryBreakdown
 * - CashflowReportRepository: getCashflow, getIncome, getSavingsRate, getExpenseClassification
 * - NetWorthReportRepository: getNetWorth, getNetWorthChanges
 * - TransactionReportRepository: getTransactions
 * - AnalyticsReportRepository: getFinancialRatios, getDebtAnalysis, getGoalsProgress, getForecast, executeCustomChart
 * - CompositeReportRepository: getAnnualReport, getSankey (orchestration only)
 *
 * MIGRATION STATUS: Complete - all methods fully migrated.
 *
 * Usage:
 *   import { analyticsReportRepository } from './repositories/reports';
 *   const data = await analyticsReportRepository.getFinancialRatios(...);
 *
 * @module repositories/reports
 */

// Base infrastructure
export { BaseReportRepository } from "./BaseReportRepository";
export type { QueryWithUser, ReportContext, DateRangeFilter } from "./types";

// Domain-specific repositories
export {
  SpendingReportRepository,
  spendingReportRepository,
} from "./SpendingReportRepository";
export {
  CashflowReportRepository,
  cashflowReportRepository,
} from "./CashflowReportRepository";
export {
  CashflowBudgetComparisonRepository,
  cashflowBudgetComparisonRepository,
} from "./CashflowBudgetComparisonRepository";
export {
  NetWorthReportRepository,
  netWorthReportRepository,
} from "./NetWorthReportRepository";
export {
  TransactionReportRepository,
  transactionReportRepository,
} from "./TransactionReportRepository";

// Analytics (financial health, projections, custom charts)
export {
  AnalyticsReportRepository,
  analyticsReportRepository,
} from "./AnalyticsReportRepository";

// Orchestration (composite reports)
export {
  CompositeReportRepository,
  compositeReportRepository,
} from "./CompositeReportRepository";
