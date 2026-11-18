import type {
  ReportsAnnualResponse,
  ReportsCashflowResponse,
  ReportsIncomeResponse,
  ReportsNetWorthResponse,
  ReportsSankeyResponse,
  ReportsSavingsRateResponse,
  ReportsSpendingBreakdownResponse,
  ReportsSpendingTrendResponse,
  ReportsTransactionsResponse,
} from "@shared/reports";
import {
  spendingReportRepository,
  cashflowReportRepository,
  netWorthReportRepository,
  transactionReportRepository,
  compositeReportRepository,
} from "../repositories/reports";
import type {
  ReportsAnnualQuery,
  ReportsCashflowQuery,
  ReportsIncomeQuery,
  ReportsNetWorthQuery,
  ReportsSankeyQuery,
  ReportsSavingsRateQuery,
  ReportsSpendingBreakdownQuery,
  ReportsSpendingTrendQuery,
  ReportsTransactionsQuery,
} from "../modules/reports/reports.validation";

/**
 * ReportService
 *
 * Orchestrates report generation (validation, defaults, feature flags, caching).
 * Delegates to modular repositories for actual data fetching.
 */
export class ReportService {
  getAnnualReport(
    householdId: string,
    query: ReportsAnnualQuery
  ): Promise<ReportsAnnualResponse> {
    return compositeReportRepository.getAnnualReport(householdId, query);
  }

  getCashflow(
    householdId: string,
    query: ReportsCashflowQuery
  ): Promise<ReportsCashflowResponse> {
    return cashflowReportRepository.getCashflow(householdId, query);
  }

  getSankey(
    householdId: string,
    query: ReportsSankeyQuery
  ): Promise<ReportsSankeyResponse> {
    return compositeReportRepository.getSankey(householdId, query);
  }

  getSpendingBreakdown(
    householdId: string,
    query: ReportsSpendingBreakdownQuery
  ): Promise<ReportsSpendingBreakdownResponse> {
    return spendingReportRepository.getSpendingBreakdown(householdId, query);
  }

  getSpendingTrend(
    householdId: string,
    query: ReportsSpendingTrendQuery
  ): Promise<ReportsSpendingTrendResponse> {
    return spendingReportRepository.getSpendingTrend(householdId, query);
  }

  getIncome(
    householdId: string,
    query: ReportsIncomeQuery
  ): Promise<ReportsIncomeResponse> {
    return cashflowReportRepository.getIncome(householdId, query);
  }

  getNetWorth(
    householdId: string,
    query: ReportsNetWorthQuery
  ): Promise<ReportsNetWorthResponse> {
    return netWorthReportRepository.getNetWorth(householdId, query);
  }

  getSavingsRate(
    householdId: string,
    query: ReportsSavingsRateQuery
  ): Promise<ReportsSavingsRateResponse> {
    return cashflowReportRepository.getSavingsRate(householdId, query);
  }

  getTransactions(
    householdId: string,
    query: ReportsTransactionsQuery
  ): Promise<ReportsTransactionsResponse> {
    return transactionReportRepository.getTransactions(householdId, query);
  }
}

export const reportService = new ReportService();
