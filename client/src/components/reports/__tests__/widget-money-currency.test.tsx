/**
 * @vitest-environment jsdom
 *
 * Report widgets show an amount in its own currency, to the cent: never in
 * dollars because a formatter was hard-coded to USD.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubcategoryBreakdownWidget } from "../SubcategoryBreakdownWidget";
import CustomChartWidget from "../CustomChartWidget";

const state = vi.hoisted(() => ({ householdCurrency: "GBP" as string | undefined }));

vi.mock("@/hooks/use-reports", () => ({
  useCurrentYearRange: () => ({ from: "2026-01-01", to: "2026-12-31", year: 2026 }),
  useReportsSubcategoryBreakdown: () => ({
    isLoading: false,
    data: {
      range: { from: "2026-01-01", to: "2026-12-31", currency: "EUR" },
      type: "expense",
      total: { amount: "42.50", currency: "EUR" },
      items: [{
        id: "groceries", label: "Groceries", parentCategory: { id: "food", name: "Food" },
        value: { amount: "42.50", currency: "EUR" }, percent: 100, color: "#000",
      }],
    },
  }),
  useReportsCustom: () => ({
    isLoading: false,
    error: null,
    data: { config: { name: "Spend", chartType: "bar", primaryMetric: "expenses" },
      data: [{ label: "Jan", primary: 42.5 }], totals: { primary: 42.5 } },
  }),
}));
vi.mock("@/hooks/use-settings", () => ({
  useCategories: () => ({ data: { groups: [] } }),
  useHousehold: () => ({ data: state.householdCurrency ? { household: { currency: state.householdCurrency } } : undefined }),
}));
vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
  ChartLegend: () => null,
  ChartLegendContent: () => null,
}));
vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  // The value axis renders one tick, so the test reads what a viewer would see.
  const Axis = ({ tickFormatter }: { tickFormatter?: (value: number) => string }) =>
    tickFormatter ? <span data-testid="value-tick">{tickFormatter(42.5)}</span> : null;
  return {
    BarChart: Stub, Bar: Stub, LineChart: Stub, Line: Stub, AreaChart: Stub, Area: Stub,
    PieChart: Stub, Pie: Stub, Cell: Stub, XAxis: Axis, YAxis: Axis, CartesianGrid: Stub,
    ComposedChart: Stub, ResponsiveContainer: Stub, Legend: Stub, Tooltip: Stub,
  };
});

afterEach(() => {
  cleanup();
  state.householdCurrency = "GBP";
});

describe("report widget amounts", () => {
  it("lists a subcategory amount in its own currency, to the cent", () => {
    render(<SubcategoryBreakdownWidget metric="expense" />);
    expect(screen.getByText("€42.50")).toBeDefined();
    expect(screen.queryByText("$42.50")).toBeNull();
  });

  it("labels a custom chart's values in the household currency", () => {
    render(<CustomChartWidget config={{ id: "c1", name: "Spend", chartType: "bar", primaryMetric: "expenses" } as never} />);
    expect(screen.getByTestId("value-tick").textContent).toBe("£42.50");
  });

  it("shows a custom chart's values without a currency until the household's is known", () => {
    state.householdCurrency = undefined;
    render(<CustomChartWidget config={{ id: "c1", name: "Spend", chartType: "bar", primaryMetric: "expenses" } as never} />);
    expect(screen.getByTestId("value-tick").textContent).toBe("42.50");
  });

  it("formats savings rates in percent even when the household currency is known", () => {
    render(<CustomChartWidget config={{ id: "c1", name: "Rate", chartType: "bar", primaryMetric: "savingsRate", order: 0 }} />);
    expect(screen.getByTestId("value-tick").textContent).toBe("42.5%");
  });
});
