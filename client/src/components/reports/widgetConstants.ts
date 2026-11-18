export interface WidgetMetadata {
  id: string;
  label: string;
  description?: string;
  isLocked?: boolean; // If true, cannot be disabled (but might be reorderable? Requirement says "locked" for always on)
  defaultOrder: number;
}

export const CORE_WIDGET_METADATA: Record<string, WidgetMetadata> = {
  summaryCards: {
    id: "summaryCards",
    label: "Summary Cards",
    description: "Key metrics at a glance",
    isLocked: true,
    defaultOrder: 0,
  },
  goalProgress: {
    id: "goalProgress",
    label: "Goal Progress",
    description: "Tracking against financial goals",
    isLocked: true,
    defaultOrder: 1,
  },
  fixedVariableExpenses: {
    id: "fixedVariableExpenses",
    label: "Fixed vs Variable",
    description: "Breakdown of expense types",
    isLocked: true,
    defaultOrder: 2,
  },
};

export const OPTIONAL_WIDGET_METADATA: Record<string, WidgetMetadata> = {
  monthlyTrends: {
    id: "monthlyTrends",
    label: "Monthly Trends",
    description: "Income, Expenses, and Savings over time",
    defaultOrder: 0,
  },
  cumulativeGrowth: {
    id: "cumulativeGrowth",
    label: "Cumulative Growth",
    description: "Year-to-date accumulation",
    defaultOrder: 1,
  },
  categoryBreakdown: {
    id: "categoryBreakdown",
    label: "Category Breakdown",
    description: "Top spending categories",
    defaultOrder: 2,
  },
  financialRatios: {
    id: "financialRatios",
    label: "Financial Ratios",
    description: "Health metrics (DTI, Savings Rate)",
    defaultOrder: 3,
  },
  forecast: {
    id: "forecast",
    label: "Forecast",
    description: "Projected net worth and savings",
    defaultOrder: 4,
  },
  netWorthChanges: {
    id: "netWorthChanges",
    label: "Net Worth Changes",
    description: "Monthly asset/liability deltas",
    defaultOrder: 5,
  },
  debtAnalysis: {
    id: "debtAnalysis",
    label: "Debt Analysis",
    description: "Debt payoff tracking",
    defaultOrder: 6,
  },
  incomeSubcategory: {
    id: "incomeSubcategory",
    label: "Income Streams",
    description: "Breakdown of income sources",
    defaultOrder: 7,
  },
  expenseSubcategory: {
    id: "expenseSubcategory",
    label: "Expense Details",
    description: "Subcategory spending breakdown",
    defaultOrder: 8,
  },
  savingsSubcategory: {
    id: "savingsSubcategory",
    label: "Savings Breakdown",
    description: "Detailed savings contributions",
    defaultOrder: 9,
  },
  debtSubcategory: {
    id: "debtSubcategory",
    label: "Debt Details",
    description: "Breakdown of debt payments",
    defaultOrder: 10,
  },
  incomePerMonth: {
    id: "incomePerMonth",
    label: "Income per Month",
    description: "Monthly income tracking with average",
    defaultOrder: 11,
  },
  expensesPerMonth: {
    id: "expensesPerMonth",
    label: "Expenses per Month",
    description: "Monthly spending tracking with average",
    defaultOrder: 12,
  },
  savingsPerMonth: {
    id: "savingsPerMonth",
    label: "Savings per Month",
    description: "Monthly savings contributions with average",
    defaultOrder: 13,
  },
  debtPerMonth: {
    id: "debtPerMonth",
    label: "Debt Paid per Month",
    description: "Monthly debt repayment with average",
    defaultOrder: 14,
  },
  netWorthChangePerMonth: {
    id: "netWorthChangePerMonth",
    label: "Net Worth Change",
    description: "Monthly delta in net worth",
    defaultOrder: 15,
  },
  incomeVsExpensesMonthly: {
    id: "incomeVsExpensesMonthly",
    label: "Income vs Expenses (Monthly)",
    description: "Monthly comparison trend",
    defaultOrder: 16,
  },
  incomeVsExpensesQuarterly: {
    id: "incomeVsExpensesQuarterly",
    label: "Income vs Expenses (Quarterly)",
    description: "Quarterly comparison trend",
    defaultOrder: 17,
  },
  incomeVsSavedComparison: {
    id: "incomeVsSavedComparison",
    label: "Income vs Saved",
    description: "Savings efficiency over time",
    defaultOrder: 18,
  },
  debtToIncomeComparison: {
    id: "debtToIncomeComparison",
    label: "DTI Trend",
    description: "Debt-to-Income ratio trend",
    defaultOrder: 19,
  },
  netWorthComparison: {
    id: "netWorthComparison",
    label: "Net Worth Trend",
    description: "Assets vs Liabilities trend",
    defaultOrder: 20,
  },
};
