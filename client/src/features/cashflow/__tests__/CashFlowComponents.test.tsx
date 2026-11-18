import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CashFlowSummary } from "../components/CashFlowSummary";
import { CashFlowTable } from "../components/CashFlowTable";
import { CashFlowChart } from "../components/CashFlowChart";

const money = (value: number, currency: string = "USD") => ({
  amount: value.toFixed(2),
  currency,
});

// Mock the remaining Nivo Sankey component.
vi.mock("@nivo/sankey", () => ({
  ResponsiveSankey: () => <div data-testid="sankey-chart">Sankey Chart</div>,
}));

describe("CashFlowSummary", () => {
  const mockTotals = {
    income: 10000,
    expenses: 4000,
    savings: 6000,
    savingsRate: 60,
  };
  const formatCurrency = (val: number) => `$${val}`;

  it("renders totals correctly", () => {
    render(
      <CashFlowSummary
        totals={mockTotals}
        actualPeriods={2}
        periodLabel="Monthly"
        formatCurrency={formatCurrency}
      />
    );
    expect(screen.getByText("Total Income")).toBeInTheDocument();
    expect(screen.getByText("$10000")).toBeInTheDocument();
    expect(screen.getByText("$4000")).toBeInTheDocument();
    expect(screen.getByText("$6000")).toBeInTheDocument(); // Net Savings
    expect(screen.getByText("$3000")).toBeInTheDocument(); // Avg Savings (6000/2)
  });
});

describe("CashFlowTable", () => {
  const formatCurrency = (val: number) => `$${val}`;
  const mockData = {
    series: [
      {
        periodStart: "2024-01-01",
        income: money(5000),
        expenses: money(2000),
        savings: money(3000),
        savingsRate: 60,
      },
    ],
  };

  it("renders table with data", () => {
    render(
      <CashFlowTable
        isLoading={false}
        error={null}
        data={mockData as any}
        formatCurrency={formatCurrency}
      />
    );
    expect(screen.getByText("Jan 2024")).toBeInTheDocument();
    expect(screen.getByText("+$5000")).toBeInTheDocument();
    expect(screen.getByText("-$2000")).toBeInTheDocument();
  });

  it("renders loading state", () => {
    const { container } = render(
      <CashFlowTable
        isLoading={true}
        error={null}
        data={undefined}
        formatCurrency={formatCurrency}
      />
    );
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});

describe("CashFlowChart", () => {
  it("renders bar chart when view is bar", () => {
    render(
      <CashFlowChart
        view="bar"
        isLoading={false}
        error={null}
        refetch={vi.fn()}
        barChartData={[
          {
            month: "Jan",
            income: 100,
            expenses: 50,
            savings: 50,
            periodStart: "2024-01-01",
            isForecast: false,
          },
        ]}
        sankeyChartData={{ nodes: [], links: [] }}
      />
    );
    // The bar view renders a recharts BarChart inside ChartContainer, exposed
    // as role="application" with an accessible label.
    expect(
      screen.getByRole("application", { name: /cash flow bar chart/i })
    ).toBeInTheDocument();
    expect(screen.queryByTestId("sankey-chart")).not.toBeInTheDocument();
  });

  it("renders sankey chart when view is sankey", async () => {
    render(
      <CashFlowChart
        view="sankey"
        isLoading={false}
        error={null}
        refetch={vi.fn()}
        barChartData={[]}
        sankeyChartData={{ nodes: [{ id: "A" }], links: [] }}
      />
    );
    // The Sankey view is code-split (lazy-loaded) to keep the heavy nivo
    // bundle off the initial chunk, so it resolves asynchronously via Suspense.
    expect(await screen.findByTestId("sankey-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });
});
