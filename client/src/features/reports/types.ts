/**
 * Reports Module Types
 *
 * Type definitions for the Reports feature module
 * Per spec: IMPLEMENTATION_PLAN.md section 1.1
 */

import { AggregationLevel } from "@/components/reports/AggregationFilter";
import type { MoneyValue } from "@shared/money";
import type { ReportsExportItem } from "@shared/reports";

// Report period types
export type ReportPeriod = "week" | "month" | "quarter" | "year" | "custom";

export interface ReportDateRange {
  startDate: string;
  endDate: string;
  period: ReportPeriod;
}

// Report tabs
export type ReportTab =
  | "annual"
  | "cash-flow"
  | "spending"
  | "merchants"
  | "income"
  | "net-worth"
  | "savings";

// Filter types
export interface ReportFilters {
  dateRange: ReportDateRange;
  accounts: string[];
  categories: string[];
  includeTransfers: boolean;
  aggregation: AggregationLevel;
}

// Section data types
export interface SpendingBreakdownData {
  items: Array<{
    id: string;
    label: string;
    value: MoneyValue;
    percentage?: number;
    color?: string;
    entityId?: string;
  }>;
  total: MoneyValue;
  range?: {
    baseCurrency?: string;
  };
}

export interface CashFlowData {
  series: Array<{
    periodStart: string;
    income: MoneyValue;
    expenses: MoneyValue;
    net?: number;
  }>;
  totals: {
    income: MoneyValue;
    expenses: MoneyValue;
    savings: MoneyValue;
    savingsRate: number;
  };
  range?: {
    baseCurrency?: string;
  };
}

export interface NetWorthData {
  current: MoneyValue;
  change: MoneyValue;
  changePercent: number;
  series: Array<{
    id: string;
    data: Array<{
      x: string;
      y: MoneyValue;
    }>;
  }>;
}

export interface SavingsRateData {
  series: Array<{
    label: string;
    savingsRate: number;
  }>;
}

export interface SankeyData {
  nodes: Array<{
    id: string;
    label?: string;
    nodeColor?: string;
  }>;
  links: Array<{
    source: string;
    target: string;
    value: number;
  }>;
}

// Merchant filter state
export interface MerchantFilters {
  search: string;
  minSpend: string;
  maxSpend: string;
  categoryFilter: string;
  range: "month" | "quarter" | "year" | "custom";
  customFrom: string;
  customTo: string;
  sort: "spend_desc" | "name_asc";
  limit: number;
}

// Unified report data type
export interface ReportData {
  spending: SpendingBreakdownData | null;
  cashflow: CashFlowData | null;
  netWorth: NetWorthData | null;
  sankey: SankeyData | null;
  savings: SavingsRateData | null;
  isLoading: boolean;
  error: Error | null;
}

// Export types
export type ReportExport = ReportsExportItem;
