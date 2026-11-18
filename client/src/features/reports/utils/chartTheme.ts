/**
 * Chart Theme Configuration
 *
 * Consistent theming for Nivo charts across the reports module
 */

export const chartTheme = {
  text: {
    fontFamily: "inherit",
    fontSize: 11,
    fill: "hsl(var(--muted-foreground))",
  },
  axis: {
    ticks: {
      text: { fill: "hsl(var(--muted-foreground))" },
    },
    legend: {
      text: { fill: "hsl(var(--muted-foreground))" },
    },
  },
  tooltip: {
    container: {
      background: "hsl(var(--popover))",
      color: "hsl(var(--popover-foreground))",
      fontSize: "12px",
      borderRadius: "var(--radius)",
      boxShadow: "var(--shadow-md)",
      border: "1px solid hsl(var(--border))",
    },
  },
};

export const chartThemeBold = {
  ...chartTheme,
  text: {
    ...chartTheme.text,
    fontSize: 12,
    fill: "hsl(var(--foreground))",
    fontWeight: 500,
  },
};

// Common colors
// Common colors using CSS variables
export const INCOME_COLOR = "hsl(var(--chart-2))"; // Emerald equivalent
export const EXPENSE_COLOR = "hsl(var(--chart-1))"; // Rose equivalent
export const PRIMARY_CHART_COLOR = "hsl(var(--chart-3))"; // Orange equivalent
export const NET_WORTH_COLOR = "hsl(var(--chart-4))"; // Blue/Sky equivalent
