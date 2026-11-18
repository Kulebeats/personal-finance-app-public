export const CASH_FLOW_CHART_COLORS = {
  budget: "hsl(var(--chart-1))",
  actual: "hsl(var(--chart-expense))",
  income: "hsl(var(--chart-income))",
  incomeForecastFill: "hsl(var(--chart-income) / 0.45)",
  incomeForecastStroke: "hsl(var(--chart-income))",
  expense: "hsl(var(--chart-expense))",
  expenseForecastFill: "hsl(var(--chart-expense) / 0.45)",
  expenseForecastStroke: "hsl(var(--chart-expense))",
  neutral: "hsl(var(--chart-neutral))",
  sankeyFallback: "hsl(var(--chart-1))",
} as const;
