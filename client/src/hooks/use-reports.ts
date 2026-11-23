import { throwIfResNotOk } from "@/lib/queryClient";
import { protectedFetch } from "@/lib/protected-fetch";
/**
 * React Query hooks for Analytics & Reporting API
 *
 * These hooks connect to the backend analytics endpoints defined in
 * docs/Analytics & Reporting Architecture.md
 *
 * Key improvements over basic implementation:
 * - useInfiniteQuery for paginated transaction drilldowns
 * - Centralized query key factories for cache management
 * - Configurable stale times per report type
 * - Utility hooks for common date ranges
 * - Prefetch utilities for faster dashboard loading
 */

import {
  useQuery,
  useInfiniteQuery,
  UseQueryOptions,
  QueryClient,
} from "@tanstack/react-query";
import { apiCall } from "@/lib/api";
import { calendarMonthRange, calendarToday, getCalendarTimeZone, useCalendarTimeZone, useCalendarYearMonth } from "@/lib/calendarZone";
import { householdMonthRange } from "@shared/household-calendar";
import { useSettings } from "@/contexts/SettingsContext";
import type {
  ReportsAnnualResponse,
  ReportsBreakdownGroupBy,
  ReportsCashflowResponse,
  ReportsCompareMode,
  ReportsIncomeResponse,
  ReportsInterval,
  ReportsNetWorthResponse,
  ReportsExportItem,
  ReportsExportsResponse,
  ReportsSankeyMode,
  ReportsSankeyResponse,
  ReportsSavingsRateResponse,
  ReportsScope,
  ReportsSort,
  ReportsSpendingBreakdownResponse,
  ReportsSpendingTrendResponse,
  ReportsTransactionsResponse,
  ReportsTxnType,
  // NEW: Annual Dashboard types
  ReportsFinancialRatiosResponse,
  ReportsDebtResponse,
  ReportsNetWorthChangesResponse,
  ReportsExpenseClassificationResponse,
  ReportsGoalsProgressResponse,
  ReportsSubcategoryBreakdownResponse,
  ReportsForecastResponse,
  ReportsCustomResponse,
  ReportsCustomParams,
} from "@shared/reports";

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Stale time configurations for different report types (in milliseconds)
 * Controls how long data is considered fresh before refetching
 */
export const REPORT_STALE_TIMES = {
  /** Annual reports - data rarely changes */
  annual: 300_000, // 5 minutes

  /** Net worth - snapshot-based, less volatile */
  netWorth: 300_000, // 5 minutes

  /** Sankey - expensive query, cache longer */
  sankey: 300_000, // 5 minutes

  /** Cashflow - moderate freshness */
  cashflow: 180_000, // 3 minutes

  /** Budget comparison - moderate freshness */
  budgetComparison: 180_000, // 3 minutes

  /** Spending breakdown - moderate freshness */
  spendingBreakdown: 180_000, // 3 minutes

  /** Spending trend - comparison data */
  spendingTrend: 120_000, // 2 minutes

  /** Income report */
  income: 180_000, // 3 minutes

  /** Savings rate */
  savingsRate: 180_000, // 3 minutes

  /** Transaction drilldown - more real-time */
  transactions: 30_000, // 30 seconds

  /** Export history - changes only when exporting */
  exports: 60_000, // 1 minute
} as const;

// ============================================================================
// API UTILITIES
// ============================================================================

type ApiSuccess<T> = { success: true; data: T; message?: string };
type ApiFailure = {
  success: false;
  error?: { code?: string; message?: string; details?: unknown };
};

/**
 * Fetch JSON from API with proper error handling
 */
async function fetchJson<T>(url: string): Promise<T> {
  const res = await protectedFetch(url, { credentials: "include" });
  await throwIfResNotOk(res);
  const json = (await res.json()) as ApiSuccess<T> | ApiFailure;

  if (!json.success) {
    const error = new Error(
      json.error?.message || "Request failed"
    ) as Error & {
      code?: string;
      details?: unknown;
    };
    error.code = json.error?.code;
    error.details = json.error?.details;
    throw error;
  }



  return json.data;
}

/**
 * Build URL search params, filtering out undefined/null values
 */
function toQueryString(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    qs.set(key, String(value));
  }
  const str = qs.toString();
  return str ? `?${str}` : "";
}

function useReportParams<T extends { timezone?: string }>(params: T): T {
  const { timezone } = useSettings();
  return { ...params, timezone: params.timezone ?? timezone };
}

// ============================================================================
// QUERY KEY FACTORIES
// ============================================================================

/**
 * Centralized query key generation for cache management
 * Use these for cache invalidation and prefetching
 *
 * @example
 * // Invalidate all reports
 * queryClient.invalidateQueries({ queryKey: reportKeys.all });
 *
 * // Invalidate specific report
 * queryClient.invalidateQueries({ queryKey: reportKeys.cashflow(params) });
 */
export const reportKeys = {
  all: ["reports"] as const,

  annual: (params: ReportsAnnualParams) =>
    ["reports", "annual", params] as const,

  cashflow: (params: ReportsCashflowParams) =>
    ["reports", "cashflow", params] as const,

  budgetComparison: (params: ReportsBudgetComparisonParams) =>
    ["reports", "cashflow", "budget", params] as const,

  sankey: (params: ReportsSankeyParams) =>
    ["reports", "sankey", params] as const,

  spendingBreakdown: (params: ReportsSpendingBreakdownParams) =>
    ["reports", "spending", "breakdown", params] as const,

  spendingTrend: (params: ReportsSpendingTrendParams) =>
    ["reports", "spending", "trend", params] as const,

  income: (params: ReportsIncomeParams) =>
    ["reports", "income", params] as const,

  netWorth: (params: ReportsNetWorthParams) =>
    ["reports", "netWorth", params] as const,

  savingsRate: (params: ReportsSavingsRateParams) =>
    ["reports", "savingsRate", params] as const,

  transactions: (params: Omit<ReportsTransactionsParams, "cursor">) =>
    ["reports", "transactions", params] as const,

  exports: (params: ReportsExportsParams) =>
    ["reports", "exports", params] as const,

  export: (id: string) => ["reports", "export", id] as const,

  // NEW: Annual Dashboard query keys
  financialRatios: (params: ReportsFinancialRatiosParams) =>
    ["reports", "financial-ratios", params] as const,

  debt: (params: Record<string, any>) => ["reports", "debt", params] as const,
  custom: (params: Record<string, any>) =>
    ["reports", "custom", params] as const,

  netWorthChanges: (params: ReportsNetWorthChangesParams) =>
    ["reports", "net-worth-changes", params] as const,

  expenseClassification: (params: ReportsExpenseClassificationParams) =>
    ["reports", "expense-classification", params] as const,

  goalsProgress: (params: ReportsGoalsProgressParams) =>
    ["reports", "goals-progress", params] as const,

  subcategoryBreakdown: (params: ReportsSubcategoryBreakdownParams) =>
    ["reports", "subcategory-breakdown", params] as const,

  forecast: (params: ReportsForecastParams) =>
    ["reports", "forecast", params] as const,
};

// ============================================================================
// TYPES
// ============================================================================

type ApiResponse<T> = {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
};

// ============================================================================
// PARAM TYPES
// ============================================================================

export type ReportsAnnualParams = {
  year: number;
  compareYear?: number;
  scope?: ReportsScope;
  includePending?: boolean;
  includeTransfers?: boolean;
  timezone?: string;
};

export type ReportsCashflowParams = {
  from: string;
  to: string;
  interval?: ReportsInterval;
  scope?: ReportsScope;
  includePending?: boolean;
  includeTransfers?: boolean;
  merchantId?: string;
  timezone?: string;
  // Forecast parameters
  includeForecast?: boolean;
  forecastMonths?: number;
};

export type ReportsBudgetComparisonParams = {
  from: string;
  to: string;
  interval?: ReportsInterval;
  scope?: ReportsScope;
  includePending?: boolean;
  includeTransfers?: boolean;
  timezone?: string;
};

export type ReportsSankeyParams = {
  from: string;
  to: string;
  mode: ReportsSankeyMode;
  maxNodes?: number;
  includeSavingsNode?: boolean;
  scope?: ReportsScope;
  includePending?: boolean;
  includeTransfers?: boolean;
  timezone?: string;
};

export type ReportsSpendingBreakdownParams = {
  from: string;
  to: string;
  groupBy?: ReportsBreakdownGroupBy;
  limit?: number;
  includeOther?: boolean;
  type?: ReportsTxnType;
  scope?: ReportsScope;
  includePending?: boolean;
  includeTransfers?: boolean;
  merchantId?: string;
  categoryGroupId?: string;
  timezone?: string;
};

export type ReportsSpendingTrendParams = {
  from: string;
  to: string;
  interval?: ReportsInterval;
  compare?: ReportsCompareMode;
  scope?: ReportsScope;
  includePending?: boolean;
  includeTransfers?: boolean;
  merchantId?: string;
  timezone?: string;
};

export type ReportsIncomeParams = {
  from: string;
  to: string;
  interval?: ReportsInterval;
  scope?: ReportsScope;
  includePending?: boolean;
  includeTransfers?: boolean;
  timezone?: string;
};

export type ReportsNetWorthParams = {
  from: string;
  to: string;
  interval?: "day" | "month";
  scope?: ReportsScope;
  includePending?: boolean;
  includeTransfers?: boolean;
  timezone?: string;
};

export type ReportsSavingsRateParams = {
  from: string;
  to: string;
  interval?: "week" | "month";
  scope?: ReportsScope;
  includePending?: boolean;
  includeTransfers?: boolean;
  timezone?: string;
};

export type ReportsTransactionsParams = {
  from: string;
  to: string;
  categoryId?: string;
  categoryGroupId?: string;
  merchantId?: string;
  accountId?: string;
  tagId?: string;
  type?: ReportsTxnType;
  search?: string;
  sort?: ReportsSort;
  limit?: number;
  cursor?: string;
  scope?: ReportsScope;
  includePending?: boolean;
  includeTransfers?: boolean;
  timezone?: string;
};

export type ReportsExportsParams = {
  status?: string;
  limit?: number;
};

// NEW: Annual Dashboard param types
export type ReportsFinancialRatiosParams = {
  from: string;
  to: string;
  scope?: ReportsScope;
  timezone?: string;
};

export type ReportsDebtParams = {
  from: string;
  to: string;
  scope?: ReportsScope;
  timezone?: string;
};

export type ReportsNetWorthChangesParams = {
  from: string;
  to: string;
  scope?: ReportsScope;
  timezone?: string;
};

export type ReportsExpenseClassificationParams = {
  from: string;
  to: string;
  scope?: ReportsScope;
  timezone?: string;
};

export type ReportsGoalsProgressParams = {
  year?: number;
  scope?: ReportsScope;
  timezone?: string;
};

export type ReportsSubcategoryBreakdownParams = {
  from: string;
  to: string;
  type?: "income" | "expense" | "savingsContributions" | "debt";
  categoryId?: string;
  groupId?: string;
  scope?: ReportsScope;
  timezone?: string;
};

export type ReportsForecastParams = {
  metric: string;
  projectionMonths: number;
  baselineMonths?: number;
  confidenceLevel?: number;
  scope?: ReportsScope;
  timezone?: string;
};

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Annual Dashboard Report
 *
 * Returns yearly totals, monthly breakdown, cumulative series, and category breakdown
 *
 * @example
 * const { data, isLoading } = useReportsAnnual({ year: 2024 });
 * // data.monthly for bar charts
 * // data.cumulativeSeries for line charts
 * // data.breakdown.expenses for pie charts
 */
export function useReportsAnnual(
  params: ReportsAnnualParams,
  options?: Omit<UseQueryOptions<ReportsAnnualResponse>, "queryKey" | "queryFn">
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.annual(queryParams),
    queryFn: async () => {
      // Check for mock data toggle
      const { USE_MOCK_DATA, getMockAnnualData } = await import(
        "@/lib/mockReportsData"
      );
      if (USE_MOCK_DATA) {
        return getMockAnnualData(params.year) as ReportsAnnualResponse;
      }
      return fetchJson<ReportsAnnualResponse>(
        `/api/reports/annual${toQueryString(queryParams)}`
      );
    },
    staleTime: REPORT_STALE_TIMES.annual,
    ...options,
  });
}

/**
 * Cash Flow Report
 *
 * Returns income vs expenses over time periods
 *
 * @example
 * const { data } = useReportsCashflow({
 *   from: "2024-01-01",
 *   to: "2024-12-31",
 *   interval: "month"
 * });
 */
export function useReportsCashflow(
  params: ReportsCashflowParams,
  options?: Omit<
    UseQueryOptions<ReportsCashflowResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.cashflow(queryParams),
    queryFn: () =>
      fetchJson<ReportsCashflowResponse>(
        `/api/reports/cashflow${toQueryString(queryParams)}`
      ),
    staleTime: REPORT_STALE_TIMES.cashflow,
    ...options,
  });
}

/**
 * Budget vs Actual Comparison Report
 *
 * Returns comparison of actual spending against budgets
 *
 * @example
 * const { data } = useReportsBudgetComparison({
 *   from: "2024-01-01",
 *   to: "2024-01-31",
 *   interval: "month"
 * });
 */
export function useReportsBudgetComparison(
  params: ReportsBudgetComparisonParams,
  options?: Omit<
    UseQueryOptions<BudgetComparisonResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.budgetComparison(queryParams),
    queryFn: () =>
      fetchJson<BudgetComparisonResponse>(
        `/api/reports/cashflow/budget${toQueryString(queryParams)}`
      ),
    staleTime: REPORT_STALE_TIMES.budgetComparison,
    ...options,
  });
}

// Budget comparison response type (matches server response)
export interface BudgetComparisonResponse {
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
}

/**
 * Sankey Diagram Report
 *
 * Returns nodes and links for Nivo Sankey visualization
 *
 * @example
 * const { data } = useReportsSankey({
 *   from: "2024-01-01",
 *   to: "2024-12-31",
 *   mode: "income_to_expense_groups"
 * });
 * // Pass data.sankey directly to ResponsiveSankey
 */
export function useReportsSankey(
  params: ReportsSankeyParams,
  options?: Omit<UseQueryOptions<ReportsSankeyResponse>, "queryKey" | "queryFn">
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.sankey(queryParams),
    queryFn: () =>
      fetchJson<ReportsSankeyResponse>(
        `/api/reports/sankey${toQueryString(queryParams)}`
      ),
    staleTime: REPORT_STALE_TIMES.sankey,
    ...options,
  });
}

/**
 * Spending Breakdown Report
 *
 * Returns spending grouped by category, merchant, or tag
 *
 * @example
 * const { data } = useReportsSpendingBreakdown({
 *   from: "2024-01-01",
 *   to: "2024-01-31",
 *   groupBy: "categoryGroup",
 *   limit: 10
 * });
 */
export function useReportsSpendingBreakdown(
  params: ReportsSpendingBreakdownParams,
  options?: Omit<
    UseQueryOptions<ReportsSpendingBreakdownResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.spendingBreakdown(queryParams),
    queryFn: () =>
      fetchJson<ReportsSpendingBreakdownResponse>(
        `/api/reports/spending/breakdown${toQueryString(queryParams)}`
      ),
    staleTime: REPORT_STALE_TIMES.spendingBreakdown,
    ...options,
  });
}

/**
 * Spending Trend Report
 *
 * Returns spending over time with optional comparison to previous period
 *
 * @example
 * const { data } = useReportsSpendingTrend({
 *   from: "2024-12-01",
 *   to: "2024-12-31",
 *   compare: "previous_period"
 * });
 */
export function useReportsSpendingTrend(
  params: ReportsSpendingTrendParams,
  options?: Omit<
    UseQueryOptions<ReportsSpendingTrendResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.spendingTrend(queryParams),
    queryFn: () =>
      fetchJson<ReportsSpendingTrendResponse>(
        `/api/reports/spending/trend${toQueryString(queryParams)}`
      ),
    staleTime: REPORT_STALE_TIMES.spendingTrend,
    ...options,
  });
}

/**
 * Income Report
 *
 * Returns income vs expenses by period
 */
export function useReportsIncome(
  params: ReportsIncomeParams,
  options?: Omit<UseQueryOptions<ReportsIncomeResponse>, "queryKey" | "queryFn">
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.income(queryParams),
    queryFn: () =>
      fetchJson<ReportsIncomeResponse>(
        `/api/reports/income${toQueryString(queryParams)}`
      ),
    staleTime: REPORT_STALE_TIMES.income,
    ...options,
  });
}

/**
 * Net Worth Report
 *
 * Returns net worth history from daily/monthly snapshots
 *
 * @example
 * const { data } = useReportsNetWorth({
 *   from: "2024-01-01",
 *   to: "2024-12-31",
 *   interval: "month"
 * });
 * // data.series is Nivo Line-ready
 */
export function useReportsNetWorth(
  params: ReportsNetWorthParams,
  options?: Omit<
    UseQueryOptions<ReportsNetWorthResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.netWorth(queryParams),
    queryFn: () =>
      fetchJson<ReportsNetWorthResponse>(
        `/api/reports/net-worth${toQueryString(queryParams)}`
      ),
    staleTime: REPORT_STALE_TIMES.netWorth,
    ...options,
  });
}

/**
 * Savings Rate Report
 *
 * Returns savings rate (savings/income) over time
 */
export function useReportsSavingsRate(
  params: ReportsSavingsRateParams,
  options?: Omit<
    UseQueryOptions<ReportsSavingsRateResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.savingsRate(queryParams),
    queryFn: () =>
      fetchJson<ReportsSavingsRateResponse>(
        `/api/reports/savings-rate${toQueryString(queryParams)}`
      ),
    staleTime: REPORT_STALE_TIMES.savingsRate,
    ...options,
  });
}

/**
 * Transactions Drilldown (Simple Query)
 *
 * Use for single-page transaction lists
 * For infinite scrolling, use useReportsTransactionsInfinite instead
 *
 * Requires at least one filter: categoryId, merchantId, accountId, tagId, type, or search
 */
export function useReportsTransactions(params: ReportsTransactionsParams) {
  const enabled =
    Boolean(params.type) ||
    Boolean(params.search) ||
    Boolean(params.categoryId) ||
    Boolean(params.categoryGroupId) ||
    Boolean(params.merchantId) ||
    Boolean(params.accountId) ||
    Boolean(params.tagId);

  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.transactions(queryParams),
    queryFn: () =>
      fetchJson<ReportsTransactionsResponse>(
        `/api/reports/transactions${toQueryString(queryParams)}`
      ),
    enabled,
    staleTime: REPORT_STALE_TIMES.transactions,
  });
}

/**
 * Transactions Drilldown (Infinite Query)
 *
 * Returns paginated transactions with cursor-based pagination
 * Use when implementing infinite scroll or "Load More" patterns
 *
 * @example
 * const {
 *   data,
 *   fetchNextPage,
 *   hasNextPage,
 *   isFetchingNextPage
 * } = useReportsTransactionsInfinite({
 *   from: "2024-01-01",
 *   to: "2024-12-31",
 *   categoryId: "uuid-here",
 *   limit: 20
 * });
 *
 * // Flatten pages for display
 * const allTransactions = data?.pages.flatMap(page => page.items) ?? [];
 */
export function useReportsTransactionsInfinite(
  params: Omit<ReportsTransactionsParams, "cursor">
) {
  const enabled =
    Boolean(params.type) ||
    Boolean(params.search) ||
    Boolean(params.categoryId) ||
    Boolean(params.categoryGroupId) ||
    Boolean(params.merchantId) ||
    Boolean(params.accountId) ||
    Boolean(params.tagId);

  const baseParams = useReportParams(params);
  return useInfiniteQuery({
    queryKey: reportKeys.transactions(baseParams),
    queryFn: async ({ pageParam }) => {
      const queryParams: ReportsTransactionsParams = {
        ...baseParams,
        cursor: pageParam as string | undefined,
      };
      return fetchJson<ReportsTransactionsResponse>(
        `/api/reports/transactions${toQueryString(queryParams)}`
      );
    },
    enabled,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    staleTime: REPORT_STALE_TIMES.transactions,
  });
}

/**
 * Export history list
 */
export function useReportsExports(
  params: ReportsExportsParams = {},
  options?: Omit<
    UseQueryOptions<ReportsExportsResponse>,
    "queryKey" | "queryFn"
  >
) {
  return useQuery({
    queryKey: reportKeys.exports(params),
    queryFn: () =>
      fetchJson<ReportsExportsResponse>(
        `/api/reports/exports${toQueryString(params)}`
      ),
    staleTime: REPORT_STALE_TIMES.exports,
    ...options,
  });
}

/**
 * Export metadata by id
 */
export function useReportsExport(
  id: string | null | undefined,
  options?: Omit<UseQueryOptions<ReportsExportItem>, "queryKey" | "queryFn">
) {
  const enabled = Boolean(id);
  return useQuery({
    queryKey: reportKeys.export(id || "unknown"),
    queryFn: () => fetchJson<ReportsExportItem>(`/api/reports/exports/${id}`),
    enabled,
    staleTime: REPORT_STALE_TIMES.exports,
    ...options,
  });
}

export function getReportsExportDownloadUrl(id: string): string {
  return `/api/reports/exports/${id}?download=true`;
}

/**
 * Create a CSV/report export and return its id. Shared by the Reports page,
 * CashFlow page, and merchant detail so the mutation goes through apiCall
 * (x-csrf-token attached; raw fetch 403s in a real browser session).
 */
export async function requestReportExport(
  payload: Record<string, unknown>,
): Promise<string> {
  const result = await apiCall<{ success: boolean; data?: { id?: string } }>(
    "/reports/exports",
    { method: "POST", body: JSON.stringify(payload) },
  );
  const id = result.data?.id;
  if (!result.success || !id) {
    throw new Error("Export failed");
  }
  return id;
}

// ============================================================================
// NEW: Annual Dashboard Hooks
// ============================================================================

/**
 * Financial Ratios (DTI, Emergency Fund, Liquidity, Burn Rate)
 */
export function useReportsFinancialRatios(
  params: ReportsFinancialRatiosParams,
  options?: Omit<
    UseQueryOptions<ReportsFinancialRatiosResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.financialRatios(queryParams),
    queryFn: async () => {
      const { USE_MOCK_DATA, getMockFinancialRatiosData } = await import(
        "@/lib/mockReportsData"
      );
      if (USE_MOCK_DATA) {
        return getMockFinancialRatiosData() as ReportsFinancialRatiosResponse;
      }
      return fetchJson<ReportsFinancialRatiosResponse>(
        `/api/reports/ratios${toQueryString(queryParams)}`
      );
    },
    staleTime: REPORT_STALE_TIMES.annual,
    ...options,
  });
}

/**
 * Debt Analysis (Total Debt, By Type, Payment Trend)
 */
export function useReportsDebt(
  params: ReportsDebtParams,
  options?: Omit<UseQueryOptions<ReportsDebtResponse>, "queryKey" | "queryFn">
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.debt(queryParams),
    queryFn: async () => {
      const { USE_MOCK_DATA, getMockDebtAnalysisData } = await import(
        "@/lib/mockReportsData"
      );
      if (USE_MOCK_DATA) {
        return getMockDebtAnalysisData() as ReportsDebtResponse;
      }
      return fetchJson<ReportsDebtResponse>(
        `/api/reports/debt${toQueryString(queryParams)}`
      );
    },
    staleTime: REPORT_STALE_TIMES.netWorth,
    ...options,
  });
}

/**
 * Net Worth Changes Over Time
 */
export function useReportsNetWorthChanges(
  params: ReportsNetWorthChangesParams,
  options?: Omit<
    UseQueryOptions<ReportsNetWorthChangesResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.netWorthChanges(queryParams),
    queryFn: async () => {
      const { USE_MOCK_DATA, getMockNetWorthChangesData } = await import(
        "@/lib/mockReportsData"
      );
      if (USE_MOCK_DATA) {
        return getMockNetWorthChangesData(queryParams);
      }
      return fetchJson<ReportsNetWorthChangesResponse>(
        `/api/reports/net-worth/changes${toQueryString(queryParams)}`
      );
    },
    staleTime: REPORT_STALE_TIMES.netWorth,
    ...options,
  });
}

/**
 * Expense Classification (Fixed vs Variable vs Discretionary)
 */
export function useReportsExpenseClassification(
  params: ReportsExpenseClassificationParams,
  options?: Omit<
    UseQueryOptions<ReportsExpenseClassificationResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.expenseClassification(queryParams),
    queryFn: async () => {
      const { USE_MOCK_DATA, getMockExpenseClassificationData } = await import(
        "@/lib/mockReportsData"
      );
      if (USE_MOCK_DATA) {
        return getMockExpenseClassificationData() as ReportsExpenseClassificationResponse;
      }
      return fetchJson<ReportsExpenseClassificationResponse>(
        `/api/reports/expenses/classification${toQueryString(queryParams)}`
      );
    },
    staleTime: REPORT_STALE_TIMES.spendingBreakdown,
    ...options,
  });
}

/**
 * Goals Progress
 */
export function useReportsGoalsProgress(
  params: ReportsGoalsProgressParams = {},
  options?: Omit<
    UseQueryOptions<ReportsGoalsProgressResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.goalsProgress(queryParams),
    queryFn: async () => {
      const { USE_MOCK_DATA, getMockGoalsProgressData } = await import(
        "@/lib/mockReportsData"
      );
      if (USE_MOCK_DATA) {
        return getMockGoalsProgressData() as ReportsGoalsProgressResponse;
      }
      return fetchJson<ReportsGoalsProgressResponse>(
        `/api/reports/goals/progress${toQueryString(queryParams)}`
      );
    },
    staleTime: REPORT_STALE_TIMES.annual,
    ...options,
  });
}

/**
 * Subcategory Breakdown
 */
export function useReportsSubcategoryBreakdown(
  params: ReportsSubcategoryBreakdownParams,
  options?: Omit<
    UseQueryOptions<ReportsSubcategoryBreakdownResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.subcategoryBreakdown(queryParams),
    queryFn: async () => {
      const { USE_MOCK_DATA, getMockSubcategoryBreakdownData } = await import(
        "@/lib/mockReportsData"
      );
      if (USE_MOCK_DATA) {
        return getMockSubcategoryBreakdownData(
          params.type
        ) as ReportsSubcategoryBreakdownResponse;
      }
      return fetchJson<ReportsSubcategoryBreakdownResponse>(
        `/api/reports/spending/subcategory${toQueryString(queryParams)}`
      );
    },
    staleTime: REPORT_STALE_TIMES.spendingBreakdown,
    ...options,
  });
}

/**
 * Forecast Projections
 */
export function useReportsForecast(
  params: ReportsForecastParams,
  options?: Omit<
    UseQueryOptions<ReportsForecastResponse>,
    "queryKey" | "queryFn"
  >
) {
  const queryParams = useReportParams(params);
  return useQuery({
    queryKey: reportKeys.forecast(queryParams),
    queryFn: async () => {
      const { USE_MOCK_DATA, getMockForecastData } = await import(
        "@/lib/mockReportsData"
      );
      if (USE_MOCK_DATA) {
        return getMockForecastData() as ReportsForecastResponse;
      }
      return fetchJson<ReportsForecastResponse>(
        `/api/reports/forecast${toQueryString(queryParams)}`
      );
    },
    staleTime: REPORT_STALE_TIMES.annual,
    ...options,
  });
}

/**
 * Custom Chart Execution
 */
/**
 * Get custom chart data
 */
export function useReportsCustom(
  params: ReportsCustomParams,
  options?: Omit<UseQueryOptions<ReportsCustomResponse>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: reportKeys.custom(params),
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      if (params.chartType) queryParams.set("chartType", params.chartType);
      if (params.primaryMetric)
        queryParams.set("primaryMetric", params.primaryMetric);
      if (params.secondaryMetric)
        queryParams.set("secondaryMetric", params.secondaryMetric);
      if (params.groupBy) queryParams.set("groupBy", params.groupBy);
      if (params.period) queryParams.set("period", params.period);
      if (params.aggregation)
        queryParams.set("aggregation", params.aggregation);
      if (params.from) queryParams.set("from", params.from);
      if (params.to) queryParams.set("to", params.to);
      if (params.limit) queryParams.set("limit", String(params.limit));

      const res = await protectedFetch(`/api/reports/custom?${queryParams.toString()}`);
      await throwIfResNotOk(res);

      const json = (await res.json()) as ApiResponse<ReportsCustomResponse>;
      if (!json.success)
        throw new Error(json.error?.message || "Unknown error");
      return json.data;
    },
    staleTime: 60 * 60 * 1000,
    ...options,
  });
}

// ============================================================================
// UTILITY HOOKS
// ============================================================================

/**
 * Get current month date range
 *
 * @example
 * const { from, to } = useCurrentMonthRange();
 * const { data } = useReportsCashflow({ from, to, interval: "day" });
 */
export function useCurrentMonthRange(): { from: string; to: string } {
  useCalendarYearMonth();
  // NEW-15: the calendar zone's month, not the browser's or UTC's.
  return calendarMonthRange();
}

/**
 * Get current year date range
 *
 * @example
 * const { from, to } = useCurrentYearRange();
 * const { data } = useReportsNetWorth({ from, to, interval: "month" });
 */
import { useSearch } from "wouter";

/**
 * Get current year date range, respecting "year" query param
 *
 * @example
 * const { from, to, year } = useCurrentYearRange();
 * const { data } = useReportsNetWorth({ from, to, interval: "month" });
 */
export function useCurrentYearRange(): {
  from: string;
  to: string;
  year: number;
} {
  const { year: householdYear } = useCalendarYearMonth();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const yearParam = params.get("year");
  const year = yearParam
    ? parseInt(yearParam, 10)
    : householdYear;

  return {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
    year,
  };
}

/**
 * Get last N months date range (rolling window)
 *
 * @example
 * const { from, to } = useLastNMonthsRange(6);
 * const { data } = useReportsCashflow({ from, to, interval: "month" });
 */
export function useLastNMonthsRange(months: number): {
  from: string;
  to: string;
} {
  useCalendarTimeZone(); // NEW-15: re-derive when the household zone arrives.
  const now = new Date();
  const to = calendarToday(now);
  const { from } = calendarMonthRange(1 - months, now);

  return { from, to };
}

/**
 * Get previous period date range (for comparison)
 *
 * @example
 * const current = useCurrentMonthRange();
 * const previous = usePreviousPeriodRange(current.from, current.to);
 */
export function usePreviousPeriodRange(
  from: string,
  to: string
): { from: string; to: string } {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const daysDiff = Math.ceil(
    (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  const prevTo = new Date(fromDate);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1); // "YYYY-MM-DD" parses as UTC midnight

  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - daysDiff);

  return {
    from: prevFrom.toISOString().split("T")[0],
    to: prevTo.toISOString().split("T")[0],
  };
}

// ============================================================================
// PREFETCH UTILITIES
// ============================================================================

/**
 * Prefetch dashboard reports for faster initial load
 * Call this on app mount or before navigation to dashboard
 *
 * @example
 * // In your app initialization or route loader
 * useEffect(() => {
 *   prefetchDashboardReports(queryClient);
 * }, []);
 */
export async function prefetchDashboardReports(
  queryClient: QueryClient,
  timezone?: string
): Promise<void> {
  const now = new Date();
  const monthRange = householdMonthRange(now, timezone ?? getCalendarTimeZone());
  const year = parseInt(monthRange.from.slice(0, 4), 10);

  const yearRange = {
    from: `${year}-01-01`,
    to: `${year}-12-31`,
  };

  // Prefetch common dashboard queries in parallel
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: reportKeys.cashflow({
        ...monthRange,
        interval: "day",
        timezone,
      }),
      queryFn: () =>
        fetchJson<ReportsCashflowResponse>(
          `/api/reports/cashflow${toQueryString({
            ...monthRange,
            interval: "day",
            timezone,
          })}`
        ),
      staleTime: REPORT_STALE_TIMES.cashflow,
    }),

    queryClient.prefetchQuery({
      queryKey: reportKeys.spendingBreakdown({
        ...monthRange,
        groupBy: "categoryGroup",
        timezone,
      }),
      queryFn: () =>
        fetchJson<ReportsSpendingBreakdownResponse>(
          `/api/reports/spending/breakdown${toQueryString({
            ...monthRange,
            groupBy: "categoryGroup",
            timezone,
          })}`
        ),
      staleTime: REPORT_STALE_TIMES.spendingBreakdown,
    }),

    queryClient.prefetchQuery({
      queryKey: reportKeys.netWorth({
        ...yearRange,
        interval: "month",
        timezone,
      }),
      queryFn: () =>
        fetchJson<ReportsNetWorthResponse>(
          `/api/reports/net-worth${toQueryString({
            ...yearRange,
            interval: "month",
            timezone,
          })}`
        ),
      staleTime: REPORT_STALE_TIMES.netWorth,
    }),
  ]);
}

/**
 * Invalidate all report caches
 * Call this after bulk transaction imports or significant data changes
 *
 * @example
 * await importTransactions(data);
 * invalidateAllReports(queryClient);
 */
export function invalidateAllReports(queryClient: QueryClient): void {
  queryClient.invalidateQueries({ queryKey: reportKeys.all });
}

/**
 * Invalidate specific report types based on what changed
 *
 * @example
 * // After a transaction is created/updated/deleted
 * invalidateReportsForChange(queryClient, "transaction");
 */
export function invalidateReportsForChange(
  queryClient: QueryClient,
  changeType: "transaction" | "account" | "category" | "budget"
): void {
  const balanceReports = [["reports", "netWorth"], ["reports", "cashflow"]];
  const invalidationMap = {
    transaction: [
      ...balanceReports,
      ["reports", "spending"],
      ["reports", "annual"],
      ["reports", "sankey"],
      ["reports", "income"],
      ["reports", "savingsRate"],
      ["reports", "transactions"],
    ],
    account: balanceReports,
    category: [
      ["reports", "spending"],
      ["reports", "annual"],
      ["reports", "sankey"],
    ],
    budget: [], // Budgets don't affect reports currently
  };

  const keysToInvalidate = invalidationMap[changeType];
  for (const queryKey of keysToInvalidate) {
    queryClient.invalidateQueries({ queryKey });
  }
}
