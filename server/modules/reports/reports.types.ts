/**
 * Reports Module - Shared Types
 *
 * Common type definitions for all report sub-modules.
 *
 * @module modules/reports/types
 */

/**
 * Report scope determines visibility level
 * - household: All transactions in the household
 * - mine: Only the current user's transactions
 */
export type ReportScope = "household" | "mine";

/**
 * Time interval for time-series data
 */
export type ReportInterval = "day" | "week" | "month";

/**
 * Base query parameters for all reports
 */
export interface BaseReportQuery {
  currency?: string;
  accountId?: string;
  compareYear?: number;
  scope?: ReportScope;
  includePending?: boolean;
  includeTransfers?: boolean;
  timezone?: string;
}

/**
 * Date range query parameters
 */
export interface DateRangeQuery extends BaseReportQuery {
  from: string;
  to: string;
}

/**
 * Spending breakdown item
 */
export interface SpendingBreakdownItem {
  id: string;
  name: string;
  amount: number;
  percentage: number;
  transactionCount: number;
  color?: string;
}

/**
 * Cashflow period data
 */
export interface CashflowPeriod {
  period: string;
  income: number;
  expenses: number;
  net: number;
}

/**
 * Net worth snapshot
 */
export interface NetWorthSnapshot {
  date: string;
  assets: number;
  liabilities: number;
  netWorth: number;
}

/**
 * Savings rate data
 */
export interface SavingsRateData {
  period: string;
  income: number;
  expenses: number;
  savings: number;
  rate: number;
}

/**
 * Annual summary data
 */
export interface AnnualSummary {
  year: number;
  totalIncome: number;
  totalExpenses: number;
  netSavings: number;
  savingsRate: number;
  monthlyBreakdown: {
    month: string;
    income: number;
    expenses: number;
    net: number;
  }[];
}

/**
 * Financial ratios data
 */
export interface FinancialRatios {
  savingsRate: number;
  debtToIncomeRatio: number;
  expenseRatio: number;
  liquidityRatio: number;
}
