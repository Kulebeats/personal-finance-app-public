/**
 * Reports Module Validation Schemas
 *
 * Zod schemas for validating report-related requests.
 *
 * @module modules/reports/reports.validation
 */

import { z } from "zod";
import { ValidationError } from "../../core/errors";

// ============================================================================
// Base Helpers
// ============================================================================

// Format AND existence: a regex alone accepts impossible dates like 2026-02-30
// (CLAUDE.md Rule 8). Reject calendar dates that do not exist.
const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    if (isNaN(d.getTime())) return false;
    const [y, m, day] = s.split("-").map(Number);
    return (
      d.getUTCFullYear() === y &&
      d.getUTCMonth() + 1 === m &&
      d.getUTCDate() === day
    );
  }, { message: "Invalid date - the date does not exist" });

// z.coerce.boolean() uses JS Boolean(), so the string "false" coerces to TRUE.
// Parse query-string booleans explicitly so "false" means false.
const booleanStringSchema = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.boolean(),
);
const scopeSchema = z.enum(["household", "mine"]);
const txnTypeSchema = z.enum(["income", "expense", "transfer"]);
const sortSchema = z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc"]);
const compareModeSchema = z.enum(["previous_period", "previous_year", "none"]);
const reportIntervalSchema = z.enum(["day", "week", "month"]);
const netWorthIntervalSchema = z.enum(["day", "month"]);
const savingsRateIntervalSchema = z.enum(["week", "month"]);
const sankeyModeSchema = z.enum([
  "income_to_expense_groups",
  "account_to_expense_groups",
  "expense_groups_to_categories",
]);

const breakdownGroupBySchema = z.preprocess(
  (value) => (value === "category_group" ? "categoryGroup" : value),
  z.enum([
    "categoryGroup",
    "category",
    "merchant",
    "merchantCategory",
    "tag",
  ])
);

const applyDateRange = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => {
    if (!value || typeof value !== "object") return value;
    const data = value as Record<string, unknown>;
    return {
      ...data,
      from: data.from ?? data.startDate,
      to: data.to ?? data.endDate,
    };
  }, schema);

const baseReportQuerySchema = z.object({
  scope: scopeSchema.optional(),
  includePending: booleanStringSchema.optional(),
  includeTransfers: booleanStringSchema.optional(),
  timezone: z.string().optional(),
  currency: z.string().optional(),
});

// ============================================================================
// Report Period Enum
// ============================================================================

export const reportPeriodSchema = z.enum([
  "week",
  "month",
  "quarter",
  "year",
  "custom",
  "all_time",
]);

export const aggregationPeriodSchema = z.enum([
  "day",
  "week",
  "month",
  "quarter",
  "year",
]);

// ============================================================================
// Date Range Schema
// ============================================================================

export const dateRangeSchema = z.object({
  startDate: dateStringSchema,
  endDate: dateStringSchema,
});

// ============================================================================
// Annual Reports
// ============================================================================

export const reportsAnnualQuerySchema = baseReportQuerySchema.extend({
  year: z.coerce.number().int().min(2000).max(2100),
  compareYear: z.coerce.number().int().min(2000).max(2100).optional(),
});

// ============================================================================
// Cash Flow Reports
// ============================================================================

const baseCashflowQuerySchema = baseReportQuerySchema.extend({
  from: dateStringSchema,
  to: dateStringSchema,
  interval: reportIntervalSchema.optional(),
  merchantId: z.string().uuid().optional(),
  // Forecast parameters
  includeForecast: booleanStringSchema.optional(),
  forecastMonths: z.coerce.number().int().min(1).max(12).optional(),
});

export const reportsCashflowQuerySchema = applyDateRange(baseCashflowQuerySchema).refine(
  (data) => !data.includeForecast || data.interval === "month",
  { message: "Forecast is only available for monthly interval", path: ["includeForecast"] }
);

// ============================================================================
// Budget Comparison Reports
// ============================================================================

export const reportsBudgetComparisonQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
    interval: reportIntervalSchema.optional(),
  })
);

// ============================================================================
// Income Reports
// ============================================================================

export const reportsIncomeQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
    interval: reportIntervalSchema.optional(),
    merchantId: z.string().uuid().optional(),
  })
);

// ============================================================================
// Savings Rate Reports
// ============================================================================

export const reportsSavingsRateQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
    interval: savingsRateIntervalSchema.optional(),
    merchantId: z.string().uuid().optional(),
  })
);

// ============================================================================
// Sankey Reports
// ============================================================================

export const reportsSankeyQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
    mode: sankeyModeSchema.optional(),
    maxNodes: z.coerce.number().int().min(5).max(200).optional(),
    includeSavingsNode: booleanStringSchema.optional(),
  })
);

// ============================================================================
// Spending Reports
// ============================================================================

export const reportsSpendingBreakdownQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
    groupBy: breakdownGroupBySchema.default("categoryGroup"),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    includeOther: booleanStringSchema.optional(),
    includePending: booleanStringSchema.optional(),
    includeTransfers: booleanStringSchema.optional(),
    type: z.enum(["income", "expense"]).optional(),
    merchantId: z.string().uuid().optional(),
    categoryGroupId: z.string().uuid().optional(),
  })
);

export const reportsSpendingTrendQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
    interval: reportIntervalSchema.optional(),
    compare: compareModeSchema.optional(),
    merchantId: z.string().uuid().optional(),
  })
);

// ============================================================================
// Net Worth Reports
// ============================================================================

export const reportsNetWorthQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
    includeArchived: booleanStringSchema.optional(),
    interval: netWorthIntervalSchema.optional(),
  })
);

// ============================================================================
// Transactions Reports
// ============================================================================

export const reportsTransactionsQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
    categoryId: z.string().uuid().optional(),
    categoryGroupId: z.string().uuid().optional(),
    merchantId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    tagId: z.string().uuid().optional(),
    type: txnTypeSchema.optional(),
    search: z.string().max(200).optional(),
    sort: sortSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  })
);

// ============================================================================
// Annual Dashboard Schemas (Section 9)
// ============================================================================

export const reportsFinancialRatiosQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
  })
);

export const reportsDebtQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
  })
);

export const reportsNetWorthChangesQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
  })
);

export const reportsExpenseClassificationQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
  })
);

export const reportsGoalsProgressQuerySchema = baseReportQuerySchema.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const reportsSubcategoryBreakdownQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    from: dateStringSchema,
    to: dateStringSchema,
    type: z.enum(["income", "expense", "savingsContributions", "debt"]).optional(),
    categoryId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
  })
);

export const reportsForecastQuerySchema = baseReportQuerySchema.extend({
  metric: z.enum(["net-worth", "expenses", "income", "net-savings", "savings"]),
  projectionMonths: z.coerce.number().int().min(1).max(60),
  baselineMonths: z.coerce.number().int().min(1).max(60).optional(),
  confidenceLevel: z.coerce.number().min(0).max(1).optional(),
});

// FIX REPORTS-CUSTOM-VAL-001: Enum validation for custom chart parameters
const primaryMetricEnum = z.enum([
  "income",
  "expenses",
  "netSavings",
  "savings",
  "savingsContributions",
  "netWorth",
  "savingsRate",
]);

const secondaryMetricEnum = z.enum(["income", "expenses", "savings"]);

const groupByEnum = z.enum([
  "categoryGroup",
  "category",
  "merchant",
  "merchantCategory",
  "tag",
  "none",
]);

const aggregationEnum = z.enum(["sum", "avg", "count", "min", "max"]);

export const reportsCustomBodySchema = z.object({
  name: z.string().max(100).optional(),
  chartType: z.enum(["bar", "line", "pie", "area", "horizontal_bar"]),
  primaryMetric: primaryMetricEnum,
  secondaryMetric: secondaryMetricEnum.optional(),
  groupBy: groupByEnum.optional(),
  aggregation: aggregationEnum.optional(),
  from: dateStringSchema,
  to: dateStringSchema,
  scope: scopeSchema.optional(),
});

export const reportsCustomQuerySchema = applyDateRange(
  baseReportQuerySchema.extend({
    name: z.string().max(100).optional(),
    chartType: z.enum(["bar", "line", "pie", "area", "horizontal_bar"]),
    primaryMetric: primaryMetricEnum,
    secondaryMetric: secondaryMetricEnum.optional(),
    groupBy: groupByEnum.optional(),
    aggregation: aggregationEnum.optional(),
    from: dateStringSchema,
    to: dateStringSchema,
  })
);

// ============================================================================
// Compatibility Aliases (legacy schema names)
// ============================================================================

export const spendingBreakdownQuerySchema = reportsSpendingBreakdownQuerySchema;
export const spendingTrendQuerySchema = reportsSpendingTrendQuerySchema;
export const cashFlowQuerySchema = reportsCashflowQuerySchema;
export const netWorthQuerySchema = reportsNetWorthQuerySchema;

// ============================================================================
// Export Schema
// ============================================================================

export const exportReportSchema = baseReportQuerySchema.extend({
  reportType: z.enum([
    "spending",
    "cashflow",
    "networth",
    "transactions",
    "budget",
  ]),
  format: z.enum(["csv", "pdf"]),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
  includeCharts: z.boolean().default(false),
  interval: reportIntervalSchema.optional(),
  groupBy: breakdownGroupBySchema.optional(),
  merchantId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  categoryGroupId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  type: txnTypeSchema.optional(),
  search: z.string().max(200).optional(),
  sort: sortSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  // Forecast options (cashflow only)
  includeForecast: z.boolean().default(false),
  forecastMonths: z.coerce.number().int().min(1).max(12).default(3),
});

const exportStatusSchema = z.enum(["pending", "completed", "failed"]);

export const reportsExportsQuerySchema = z.object({
  status: exportStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const reportsExportParamsSchema = z.object({
  id: z.string().uuid(),
});

// ============================================================================
// Validation Helpers
// ============================================================================

export function validateDateRange(from?: string, to?: string) {
  if (!from || !to) {
    throw new ValidationError("Date range is required", [
      { field: "from", message: "Required" },
      { field: "to", message: "Required" },
    ]);
  }
  const start = new Date(from);
  const end = new Date(to);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ValidationError("Invalid date format. Use YYYY-MM-DD", [
      { field: "format", message: "YYYY-MM-DD" },
    ]);
  }
  if (start > end) {
    throw new ValidationError("Start date cannot be after end date", [
      { field: "range", message: "Invalid range" },
    ]);
  }
  const maxRangeMs = 1000 * 60 * 60 * 24 * 365 * 2;
  if (end.getTime() - start.getTime() > maxRangeMs) {
    throw new ValidationError("Date range cannot exceed 2 years", [
      { field: "range", message: "Max 2 years" },
    ]);
  }
}

export function validateLimit(limit?: number): number {
  if (!limit || limit < 1) return 50;
  if (limit > 1000) return 1000;
  return limit;
}

export function validateMaxNodes(maxNodes?: number): number {
  if (!maxNodes || maxNodes < 1) return 20;
  if (maxNodes > 50) return 50;
  return maxNodes;
}

export function encodeCursor(
  date: Date | string,
  id: string,
  amount?: number | string
): string {
  const dateStr = date instanceof Date ? date.toISOString() : date;
  const parts = [dateStr, id];
  if (amount !== undefined) {
    parts.push(String(amount));
  }
  return Buffer.from(parts.join("|")).toString("base64");
}

export function parseCursor(
  cursor?: string | null
): { date: string; id: string; amount?: string } | null {
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const [date, id, amount] = decoded.split("|");
    if (!date || !id) return null;
    return { date, id, amount };
  } catch {
    return null;
  }
}

// ============================================================================
// Type Exports
// ============================================================================

export type DateRange = z.infer<typeof dateRangeSchema>;
export type ExportReportInput = z.infer<typeof exportReportSchema>;

export type ReportsAnnualQuery = z.infer<typeof reportsAnnualQuerySchema>;
export type ReportsCashflowQuery = z.infer<typeof reportsCashflowQuerySchema>;
export type ReportsBudgetComparisonQuery = z.infer<typeof reportsBudgetComparisonQuerySchema>;
export type ReportsIncomeQuery = z.infer<typeof reportsIncomeQuerySchema>;
export type ReportsSavingsRateQuery = z.infer<typeof reportsSavingsRateQuerySchema>;
export type ReportsSpendingBreakdownQuery = z.infer<
  typeof reportsSpendingBreakdownQuerySchema
>;
export type ReportsSpendingTrendQuery = z.infer<
  typeof reportsSpendingTrendQuerySchema
>;
export type ReportsNetWorthQuery = z.infer<typeof reportsNetWorthQuerySchema>;
export type ReportsSankeyQuery = z.infer<typeof reportsSankeyQuerySchema>;
export type ReportsTransactionsQuery = z.infer<
  typeof reportsTransactionsQuerySchema
>;
export type ReportsFinancialRatiosQuery = z.infer<
  typeof reportsFinancialRatiosQuerySchema
>;
export type ReportsDebtQuery = z.infer<typeof reportsDebtQuerySchema>;
export type ReportsNetWorthChangesQuery = z.infer<
  typeof reportsNetWorthChangesQuerySchema
>;
export type ReportsExpenseClassificationQuery = z.infer<
  typeof reportsExpenseClassificationQuerySchema
>;
export type ReportsGoalsProgressQuery = z.infer<
  typeof reportsGoalsProgressQuerySchema
>;
export type ReportsSubcategoryBreakdownQuery = z.infer<
  typeof reportsSubcategoryBreakdownQuerySchema
>;
export type ReportsForecastQuery = z.infer<typeof reportsForecastQuerySchema>;
export type ReportsCustomBody = z.infer<typeof reportsCustomBodySchema>;
export type ReportsCustomQuery = z.infer<typeof reportsCustomQuerySchema>;
export type ReportsExportsQuery = z.infer<typeof reportsExportsQuerySchema>;
export type ReportsExportParams = z.infer<typeof reportsExportParamsSchema>;

// Legacy type aliases
export type SpendingBreakdownQuery = ReportsSpendingBreakdownQuery;
export type SpendingTrendQuery = ReportsSpendingTrendQuery;
export type CashFlowQuery = ReportsCashflowQuery;
export type NetWorthQuery = ReportsNetWorthQuery;
