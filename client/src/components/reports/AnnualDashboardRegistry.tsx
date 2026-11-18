/**
 * Widget Registry for Annual Dashboard
 *
 * Contains widget type definitions and registry mappings.
 * Heavy widgets use React.lazy for code splitting to reduce initial bundle size.
 */

import React from "react";
import { AggregationLevel } from "./AggregationFilter";

// Core widgets - loaded eagerly since they're always visible
import AnnualSummaryWidget from "./AnnualSummaryWidget";
import { GoalsProgressWidget } from "./GoalsProgressWidget";
import { ExpenseClassificationWidget } from "./ExpenseClassificationWidget";

// Monthly and comparison widget modules - static imports (named exports)
import {
  IncomePerMonthWidget,
  ExpensesPerMonthWidget,
  SavingsPerMonthWidget,
  DebtPerMonthWidget,
  NetWorthChangeWidget,
} from "./AnnualDashboardMonthlyWidgets";
import {
  IncomeVsExpensesComparisonWidget,
  IncomeVsSavedComparisonWidget,
  DebtToIncomeComparisonWidget,
  NetWorthTrendWidget,
} from "./AnnualDashboardComparisonWidgets";

// Optional widgets - lazy loaded for better initial performance
const FinancialRatiosWidget = React.lazy(() =>
  import("./FinancialRatiosWidget").then((m) => ({
    default: m.FinancialRatiosWidget,
  })),
);
const ForecastWidget = React.lazy(() =>
  import("./ForecastWidget").then((m) => ({ default: m.ForecastWidget })),
);
const NetWorthChangesWidget = React.lazy(() =>
  import("./NetWorthChangesWidget").then((m) => ({
    default: m.NetWorthChangesWidget,
  })),
);
const DebtAnalysisWidget = React.lazy(() =>
  import("./DebtAnalysisWidget").then((m) => ({
    default: m.DebtAnalysisWidget,
  })),
);
const SubcategoryBreakdownWidget = React.lazy(() =>
  import("./SubcategoryBreakdownWidget").then((m) => ({
    default: m.SubcategoryBreakdownWidget,
  })),
);

// Chart-heavy widgets - lazy loaded
const CumulativeGrowthWidget = React.lazy(
  () => import("./CumulativeGrowthWidget"),
);
const MonthlyTrendsWidget = React.lazy(() => import("./MonthlyTrendsWidget"));
const CategoryBreakdownWidget = React.lazy(
  () => import("./CategoryBreakdownWidget"),
);

// ============================================================================
// WIDGET TYPES
// ============================================================================

export interface BaseWidgetProps {
  className?: string;
  onHide?: () => void;
  aggregation?: AggregationLevel;
}

export type WidgetComponent = React.FC<BaseWidgetProps>;

// ============================================================================
// SUBCATEGORY WIDGET WRAPPERS
// ============================================================================

const IncomeSubcategoryWidget: WidgetComponent = (props) => (
  <SubcategoryBreakdownWidget {...props} metric="income" />
);
const ExpenseSubcategoryWidget: WidgetComponent = (props) => (
  <SubcategoryBreakdownWidget {...props} metric="expense" />
);
const SavingsSubcategoryWidget: WidgetComponent = (props) => (
  <SubcategoryBreakdownWidget {...props} metric="savingsContributions" />
);
const DebtSubcategoryWidget: WidgetComponent = (props) => (
  <SubcategoryBreakdownWidget {...props} metric="debt" />
);

// ============================================================================
// WIDGET REGISTRY
// ============================================================================

export const CORE_WIDGETS: Record<string, WidgetComponent> = {
  summaryCards: AnnualSummaryWidget,
  goalProgress: GoalsProgressWidget,
  fixedVariableExpenses: ExpenseClassificationWidget,
};

export const OPTIONAL_WIDGETS: Record<string, WidgetComponent> = {
  monthlyTrends: MonthlyTrendsWidget,
  cumulativeGrowth: CumulativeGrowthWidget,
  categoryBreakdown: CategoryBreakdownWidget,
  financialRatios: FinancialRatiosWidget,
  forecast: ForecastWidget,
  netWorthChanges: NetWorthChangesWidget,
  debtAnalysis: DebtAnalysisWidget,
  incomeSubcategory: IncomeSubcategoryWidget,
  expenseSubcategory: ExpenseSubcategoryWidget,
  savingsSubcategory: SavingsSubcategoryWidget,
  debtSubcategory: DebtSubcategoryWidget,
  incomePerMonth: IncomePerMonthWidget,
  expensesPerMonth: ExpensesPerMonthWidget,
  savingsPerMonth: SavingsPerMonthWidget,
  debtPerMonth: DebtPerMonthWidget,
  netWorthChangePerMonth: NetWorthChangeWidget,
  incomeVsExpensesMonthly: (props: BaseWidgetProps) => (
    <IncomeVsExpensesComparisonWidget {...props} aggregation="monthly" />
  ),
  incomeVsExpensesQuarterly: (props: BaseWidgetProps) => (
    <IncomeVsExpensesComparisonWidget {...props} aggregation="quarterly" />
  ),
  incomeVsSavedComparison: IncomeVsSavedComparisonWidget,
  debtToIncomeComparison: DebtToIncomeComparisonWidget,
  netWorthComparison: NetWorthTrendWidget,
};
