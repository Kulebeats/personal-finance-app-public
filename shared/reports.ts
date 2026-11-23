import type { MoneyDto } from "./money";

export type ReportsInterval = "day" | "week" | "month";
export type ReportsScope = "household" | "mine";
export type ReportsTxnType = "income" | "expense" | "transfer";
export type ReportsSort =
  | "date_desc"
  | "date_asc"
  | "amount_desc"
  | "amount_asc";

export type ReportsSankeyMode =
  | "income_to_expense_groups"
  | "account_to_expense_groups"
  | "expense_groups_to_categories";

export type ReportsBreakdownGroupBy =
  | "categoryGroup"
  | "category"
  | "merchant"
  | "merchantCategory"
  | "tag";

export type ReportsCompareMode = "previous_period" | "previous_year" | "none";

export type ReportsAnnualResponse = {
  year: number;
  compareYear?: number;
  baseCurrency: string;
  monthsInRange: number;

  totals: {
    income: MoneyDto;
    expenses: MoneyDto;
    savingsContributions: MoneyDto;
    netSavings: MoneyDto;
    debtPaid: MoneyDto;
    netWorth: MoneyDto;
    savingsRate: number;
    netSavingsRate: number;
    totalNetWorthChange: MoneyDto;
    avgMonthlyNetWorthChange: MoneyDto;
  };
  comparison?: {
    incomeChangePct: number;
    expensesChangePct: number;
    savingsContributionsChangePct: number;
    netSavingsChangePct: number;
    debtPaidChangePct: number;
    netWorthChangePct: number;
  };

  monthly: Array<{
    /** Display label, e.g. "Jan 2026". */
    month: string;
    /** ISO first day of the month (YYYY-MM-DD). */
    periodStart: string;
    monthIndex: number;
    income: MoneyDto;
    expenses: MoneyDto;
    savingsContributions: MoneyDto;
    netSavings: MoneyDto;
    savingsRate: number;
    netSavingsRate: number;
    debtPaid: MoneyDto;
    netWorthChange: MoneyDto;
  }>;

  cumulativeSeries: Array<{
    id:
      | "Income"
      | "Expenses"
      | "SavingsContributions"
      | "DebtPaid"
      | "NetWorth";
    color?: string;
    data: Array<{ x: string; y: MoneyDto }>;
  }>;

  breakdown: {
    income: Array<{
      id: string;
      label: string;
      value: MoneyDto;
      color?: string;
      entityId: string;
    }>;
    expenses: Array<{
      id: string;
      label: string;
      value: MoneyDto;
      color?: string;
      entityId: string;
    }>;
    savingsContributions: Array<{
      id: string;
      label: string;
      value: MoneyDto;
      color?: string;
      entityId: string;
    }>;
  };
  generatedAt?: string;
};

export type ReportsCashflowResponse = {
  range: {
    from: string;
    to: string;
    interval: ReportsInterval;
    baseCurrency: string;
    /** Periods that have started on the household calendar; averages divide by this (NEW-34). */
    elapsedPeriods?: number;
  };
  series: Array<{
    periodStart: string;
    periodEnd: string;
    label: string;
    income: MoneyDto;
    expenses: MoneyDto;
    savings: MoneyDto;
    savingsRate: number;
    debt: MoneyDto;
    isForecast?: boolean;
  }>;
  totals: {
    income: MoneyDto;
    expenses: MoneyDto;
    savings: MoneyDto;
    savingsRate: number;
    debt: MoneyDto;
  };
  /** Totals of the started periods only: the numerator for averages over elapsedPeriods (NEW-34). */
  elapsedTotals?: { income: MoneyDto; expenses: MoneyDto; savings: MoneyDto };
  metadata?: {
    currencyMode: "household" | "mixed";
    baseCurrency: string;
    generatedAt: string;
    forecastConfig?: {
      enabled: boolean;
      horizonMonths: number;
      dataSourcesUsed: ("recurring" | "budgets" | "averages")[];
    };
  };
  generatedAt?: string;
};

export type ReportsSankeyResponse = {
  range: { from: string; to: string; baseCurrency: string };
  mode: ReportsSankeyMode;
  totals: { income: MoneyDto; expenses: MoneyDto; savings: MoneyDto };
  sankey: {
    nodes: Array<{
      id: string;
      label?: string;
      nodeColor?: string;
      entityType?:
        | "categoryGroup"
        | "category"
        | "merchant"
        | "account"
        | "synthetic";
      entityId?: string;
    }>;
    links: Array<{
      source: string;
      target: string;
      value: MoneyDto;
      meta?: { entityType?: string; entityId?: string };
    }>;
  };
  generatedAt?: string;
};

export type ReportsSpendingBreakdownResponse = {
  range: { from: string; to: string; baseCurrency: string };
  groupBy: ReportsBreakdownGroupBy;
  total: MoneyDto;
  items: Array<{
    id: string;
    label: string;
    value: MoneyDto;
    percent: number;
    color?: string;
    entityType: ReportsBreakdownGroupBy;
    entityId: string;
  }>;
  generatedAt?: string;
};

export type ReportsSpendingTrendResponse = {
  range: {
    from: string;
    to: string;
    interval: ReportsInterval;
    baseCurrency: string;
  };
  compare: ReportsCompareMode;
  totals: { current: MoneyDto; previous?: MoneyDto; changePct?: number };
  series: Array<{ date: string; current: MoneyDto; previous?: MoneyDto }>;
  generatedAt?: string;
};

export type ReportsIncomeResponse = {
  range: {
    from: string;
    to: string;
    interval: ReportsInterval;
    baseCurrency: string;
  };
  series: Array<{
    label: string;
    income: MoneyDto;
    expenses: MoneyDto;
    net: MoneyDto;
  }>;
  totals: { income: MoneyDto; expenses: MoneyDto; net: MoneyDto };
  generatedAt?: string;
};

export type ReportsNetWorthResponse = {
  range: {
    from: string;
    to: string;
    interval: "day" | "month";
    baseCurrency: string;
  };
  latest: {
    date: string;
    netWorth: MoneyDto;
    assets: MoneyDto;
    liabilities: MoneyDto;
  };
  series: Array<{
    id: string;
    data: Array<{ x: string; y: MoneyDto }>;
    color?: string;
  }>;
  breakdown?: {
    assetsByType: Array<{ type: string; value: MoneyDto }>;
    liabilitiesByType: Array<{ type: string; value: MoneyDto }>;
  };
  /**
   * Set on the current-balance fallback only (FIN-14). True when a valuation
   * class (holdings, tbills, pensions, bonds) could not be valued and was left
   * out of the totals; `omittedValuations` names them.
   */
  incomplete?: boolean;
  omittedValuations?: Array<"holdings" | "tbills" | "pensions" | "bonds">;
  /**
   * NEW-34 (RC-14): "snapshots" when the series is recorded snapshots;
   * "current_only" when it is one point valued from today's balances.
   */
  historyCoverage?: NetWorthHistoryCoverage;
  generatedAt?: string;
};

export type NetWorthHistoryCoverage = "snapshots" | "current_only";

export type ReportsSavingsRateResponse = {
  range: {
    from: string;
    to: string;
    interval: "week" | "month";
    baseCurrency: string;
  };
  series: Array<{
    periodStart: string;
    periodEnd: string;
    label: string;
    savingsRate: number;
    income: MoneyDto;
    expenses: MoneyDto;
    savings: MoneyDto;
  }>;
  generatedAt?: string;
};

export type ReportsTransactionsResponse = {
  page: { limit: number; nextCursor?: string | null };
  items: Array<{
    /** The transaction id; a split transaction appears once per split (NEW-14). */
    id: string;
    /** The split this row is, or null when the transaction is not split. */
    splitId?: string | null;
    date: string;
    name: string;
    merchant?: { id: string; name: string } | null;
    category?: { id: string; name: string; groupId: string } | null;
    account?: { id: string; name: string } | null;
    type: ReportsTxnType;
    amount: MoneyDto;
    signedAmount: MoneyDto;
    currency: string;
    baseCurrency: string;
    amountBase: MoneyDto;
    signedAmountBase: MoneyDto;
    notes?: string | null;
    isPending: boolean;
    reviewedAt?: string | null;
    tags?: Array<{ id: string; name: string }> | null;
  }>;
  generatedAt?: string;
};

export type ReportsExportStatus = "pending" | "completed" | "failed";

export type ReportsExportItem = {
  id: string;
  userId: string | null;
  householdId: string | null;
  exportType: string;
  fileFormat: string;
  fileUrl?: string | null;
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
  recordCount?: number | null;
  // FIX REPORTS-EXPORT-002: Store export parameters for reproducible downloads
  parameters?: Record<string, unknown> | null; // Original export request parameters (filters, includePending, scope)
  status: ReportsExportStatus | string;
  createdAt: string;
};

export type ReportsExportsResponse = {
  exports: ReportsExportItem[];
};

// =============================================================================
// NEW: Annual Dashboard Response Types (Section 9 of Requirements)
// =============================================================================

// Financial Ratios (Section 9.2)
export type ReportsFinancialRatiosResponse = {
  range: { from: string; to: string; baseCurrency: string };
  ratios: {
    dti: {
      value: number;
      monthlyDebt: MoneyDto;
      monthlyIncome: MoneyDto;
      status: "good" | "warning" | "bad";
    };
    emergencyFund: {
      value: number;
      months: number;
      monthlyExpenses: MoneyDto;
      liquidAssets: MoneyDto;
      status: "good" | "warning" | "bad";
    };
    liquidityRatio: {
      value: number;
      liquidAssets: MoneyDto;
      currentLiabilities: MoneyDto;
      status: "good" | "warning" | "bad";
    };
    burnRate: {
      value: number;
      months: number;
      liquidAssets: MoneyDto;
      monthlyExpenses: MoneyDto;
      status: "good" | "warning" | "bad";
    };
    savingsRate: { value: number; savings: MoneyDto; income: MoneyDto };
    netSavingsRate: {
      value: number;
      netSavings: MoneyDto;
      income: MoneyDto;
    };
  };
  generatedAt?: string;
};

// Debt Analysis (Section 9.3)
export type ReportsDebtResponse = {
  range: { from: string; to: string; currency: string };
  totalDebt: MoneyDto;
  debtByType: Array<{ type: string; balance: MoneyDto; accounts: number }>;
  paymentTrend: Array<{ period: string; amount: MoneyDto }>;
  topDebtAccounts: Array<{
    id: string;
    name: string;
    balance: MoneyDto;
    type: string;
  }>;
  generatedAt?: string;
};

// Net Worth Changes (Section 9.4)
export type ReportsNetWorthChangesResponse = {
  range: { from: string; to: string; currency: string };
  totalChange: MoneyDto;
  /** Endpoint change divided by elapsed calendar months, or null without a comparable pair. */
  avgMonthlyChange: MoneyDto | null;
  periods: Array<{
    period: string;
    startNetWorth: MoneyDto;
    endNetWorth: MoneyDto;
    change: MoneyDto;
    changePct: number;
    /** The recorded point this change is measured from. */
    startPeriod?: string;
    /** True when a month with no snapshot lies between the two points (NEW-34). */
    spansGap?: boolean;
  }>;
  historyCoverage?: NetWorthHistoryCoverage;
  /** Started months ("YYYY-MM") in the range with no snapshot (NEW-34). */
  missingMonths?: string[];
  /** No comparable endpoints in different recorded months. */
  insufficientHistory?: boolean;
  generatedAt?: string;
};

// Expense Classification (Section 9.5)
export type ExpenseClassificationType = "fixed" | "variable" | "discretionary";
export type ReportsExpenseClassificationResponse = {
  range: { from: string; to: string; currency: string };
  total: MoneyDto;
  classification: {
    fixed: {
      amount: MoneyDto;
      percent: number;
      categories: Array<{ id: string; name: string; amount: MoneyDto }>;
    };
    variable: {
      amount: MoneyDto;
      percent: number;
      categories: Array<{ id: string; name: string; amount: MoneyDto }>;
    };
    discretionary: {
      amount: MoneyDto;
      percent: number;
      categories: Array<{ id: string; name: string; amount: MoneyDto }>;
    };
  };
  generatedAt?: string;
};

// Goals Progress (Section 9.6)
export type ReportsGoalsProgressResponse = {
  goals: Array<{
    id: string;
    name: string;
    type: "save_up" | "pay_down" | "investment";
    /** Null for a debt goal whose progress is unavailable (it is the debt's balance). */
    targetAmount: MoneyDto | null;
    /** Null, like progress, onTrack and monthlyRequired, when progress is unavailable. */
    currentAmount: MoneyDto | null;
    progress: number | null;
    projectedCompletion?: string | null;
    onTrack: boolean | null;
    monthlyRequired?: MoneyDto | null;
    /** "unavailable" when some of the goal's progress sources are hidden from the viewer. */
    progressAvailability: "available" | "unavailable";
  }>;
  summary: {
    totalGoals: number;
    onTrackCount: number;
    behindCount: number;
    completedCount: number;
  };
  generatedAt?: string;
};

// Subcategory Breakdown (Section 9.10)
export type ReportsSubcategoryBreakdownResponse = {
  range: { from: string; to: string; currency: string };
  type: "income" | "expense" | "savingsContributions" | "debt";
  categoryId?: string;
  total: MoneyDto;
  items: Array<{
    id: string;
    label: string;
    parentCategory: { id: string; name: string };
    value: MoneyDto;
    percent: number;
    color?: string;
  }>;
  generatedAt?: string;
};

// Forecast (Section 9.7)
export type ReportsForecastResponse = {
  metric: string;
  baseline: {
    months: number;
    average: number;
    trend: number; // Slope from linear regression
  };
  projection: Array<{
    month: string;
    predicted: number;
    lowerBound: number;
    upperBound: number;
  }>;
  confidenceLevel: number;
  generatedAt?: string;
};

// Custom Chart (Section 9.9)
export const CUSTOM_CHART_PERIODS = ["monthly", "quarterly", "biannual", "annual"] as const;
export type CustomChartPeriod = (typeof CUSTOM_CHART_PERIODS)[number];
export const DEFAULT_CUSTOM_CHART_PERIOD: CustomChartPeriod = "monthly";

export const CUSTOM_CHART_AGGREGATIONS = ["sum", "avg", "count", "min", "max"] as const;
export type CustomChartAggregation = (typeof CUSTOM_CHART_AGGREGATIONS)[number];

export const CUSTOM_CHART_PRIMARY_METRICS = ["income", "expenses", "netSavings", "savings", "netWorth", "savingsRate"] as const;
export const CUSTOM_CHART_SECONDARY_METRICS = ["income", "expenses", "savings"] as const;
export const CUSTOM_CHART_GROUPS = ["categoryGroup", "category", "merchant", "merchantCategory", "tag"] as const;

export function canUseCustomChartMetric(metric: string): boolean {
  return CUSTOM_CHART_PRIMARY_METRICS.some(option => option === metric);
}

export function canGroupCustomChartMetric(metric: string): boolean {
  return metric === "income" || metric === "expenses";
}

export function customChartGroup(metric: string, groupBy?: string): ReportsBreakdownGroupBy | undefined {
  return canGroupCustomChartMetric(metric) ? CUSTOM_CHART_GROUPS.find(option => option === groupBy) : undefined;
}

export function canCompareCustomChartMetrics(metric: string, groupBy?: string): boolean {
  return canUseCustomChartMetric(metric) && !groupBy && metric !== "savingsRate" && metric !== "netWorth";
}

export function customChartComparison(metric: string, groupBy?: string, secondaryMetric?: string): string | undefined {
  return canCompareCustomChartMetrics(metric, groupBy)
    ? CUSTOM_CHART_SECONDARY_METRICS.find(option => option === secondaryMetric)
    : undefined;
}

export type CustomChartQueryConfig = {
  name: string;
  chartType: string;
  primaryMetric: string;
  secondaryMetric?: string;
  groupBy?: string;
  period?: CustomChartPeriod;
  aggregation?: CustomChartAggregation;
};

export type ReportsCustomResponse = {
  chartId?: string;
  config: CustomChartQueryConfig;
  data: Array<{
    label: string;
    primary: number;
    secondary?: number;
    groupKey?: string;
  }>;
  totals: {
    primary: number;
    secondary?: number;
    average?: number;
  };
  generatedAt?: string;
};

// Widget Preferences (Section 8)
export type WidgetPreference = {
  id?: string;
  enabled: boolean;
  order: number;
  chartType?: string;
  expanded?: boolean;
};

/** Widget identity derived for UI entries from the persisted map key. */
export type IdentifiedWidgetPreference = WidgetPreference & { id: string };

export type CustomChartConfig = {
  id: string;
  name: string;
  chartType: string;
  primaryMetric: string;
  secondaryMetric?: string;
  groupBy?: string;
  period?: CustomChartPeriod;
  /** Previously saved charts may store a period here. */
  aggregation?: string;
  showAverage?: boolean;
  showComparison?: boolean;
  createdAt?: string;
  order: number;
};

export type ReportsCustomParams = Omit<CustomChartQueryConfig, "name"> & {
  from?: string;
  to?: string;
  limit?: number;
};

export function customChartPeriod(config: Pick<CustomChartConfig, "period" | "aggregation">): CustomChartPeriod {
  return config.period ?? CUSTOM_CHART_PERIODS.find(period => period === config.aggregation) ?? DEFAULT_CUSTOM_CHART_PERIOD;
}

export type ReportWidgetPreferences = {
  coreWidgets: Record<string, WidgetPreference>;
  optionalWidgets: Record<string, WidgetPreference>;
  customCharts: CustomChartConfig[];
  hasCompletedWidgetSetup?: boolean;
};

export type ReportWidgetPreferencesPatch = Omit<
  Partial<ReportWidgetPreferences>,
  "coreWidgets" | "optionalWidgets"
> & {
  coreWidgets?: Record<string, Partial<WidgetPreference>>;
  optionalWidgets?: Record<string, Partial<WidgetPreference>>;
};

/** Layout reset values shared with the server writer and response validator. */
export const REPORT_WIDGET_DEFAULT_LAYOUT = {
  coreWidgets: {
    summaryCards: { enabled: true, order: 0, chartType: "cards" },
    goalProgress: { enabled: true, order: 1, chartType: "progressBars" },
    fixedVariableExpenses: { enabled: true, order: 2, chartType: "donut" },
  },
  optionalWidgets: {
    monthlyTrends: { enabled: true, order: 0, chartType: "bar" },
    netWorthTimeline: { enabled: true, order: 1, chartType: "area" },
    savingsRate: { enabled: true, order: 2, chartType: "line" },
    incomeBreakdown: { enabled: false, order: 3, chartType: "bar" },
    topMerchants: { enabled: false, order: 4, chartType: "bar" },
    categoryTrends: { enabled: false, order: 5, chartType: "line" },
    debtPaydown: { enabled: false, order: 6, chartType: "area" },
    sankeyFlow: { enabled: false, order: 7, chartType: "sankey" },
  },
} satisfies Pick<ReportWidgetPreferences, "coreWidgets" | "optionalWidgets">;
