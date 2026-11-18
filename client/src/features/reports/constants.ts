/**
 * Reports Module Constants
 *
 * Configuration and constants for the Reports feature module
 * Per spec: IMPLEMENTATION_PLAN.md section 1.1
 */

// Chart color palette
export const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
] as const;

// Tab definitions
export const REPORT_TABS = [
  { id: "annual", label: "Annual Dashboard" },
  { id: "cash-flow", label: "Cash Flow" },
  { id: "spending", label: "Spending" },
  { id: "merchants", label: "Merchants" },
  { id: "income", label: "Income" },
  { id: "net-worth", label: "Net Worth" },
  { id: "savings", label: "Savings" },
] as const;

// Aggregation options
export const AGGREGATION_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual", label: "Annual" },
] as const;

// Merchant range options
export const MERCHANT_RANGE_OPTIONS = [
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "year", label: "This Year" },
  { value: "custom", label: "Custom Range" },
] as const;

// Spending groupBy options
export const SPENDING_GROUP_OPTIONS = [
  { value: "categoryGroup", label: "Category Group" },
  { value: "category", label: "Category" },
  { value: "merchant", label: "Merchant" },
] as const;

// Default values
export const DEFAULT_MERCHANT_LIMIT = 25;
export const DEFAULT_SPENDING_LIMIT = 10;
