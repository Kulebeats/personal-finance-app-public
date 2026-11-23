/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NetWorthSummary } from "../components/NetWorthSummary";
import { NetWorthChart } from "../components/NetWorthChart";

vi.mock("recharts", () => ({ ResponsiveContainer: () => <div aria-label="Net worth plot" />,
  AreaChart: () => null, Area: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null }));
const props = { groupedAccounts: {}, assetGroups: [], liabilityGroups: [], summaryMode: "totals" as const,
  onSummaryModeChange: vi.fn(), onExport: vi.fn(), isExporting: false, getGroupTotal: vi.fn() };
it("states the same account-linked coverage for supported numeric summaries", () => {
  render(<NetWorthSummary {...props} data={{ totalAssets: 100, totalLiabilities: 0, netWorthValue: 100 }} />);
  expect(screen.getByText(/Visible account-linked wealth/i)).toBeInTheDocument();
  expect(screen.getByText(/Legacy instruments without proven account access are not included/i)).toBeInTheDocument();
});
it("does not display a fabricated zero when visible valuation inputs are unavailable", () => {
  const data = { totalAssets: 0, totalLiabilities: 0, netWorthValue: 0, available: false };
  render(<NetWorthSummary {...props} data={data} />);
  expect(screen.getByRole("alert")).toHaveTextContent(/Valuation unavailable/i);
  expect(screen.queryByText(/K0\.00/)).not.toBeInTheDocument();
});
it("withholds a chart and current zero when its current valuation is unavailable", () => {
  const input = { data: [], currentNetWorth: 0, isLoading: false, unavailable: true };
  render(<NetWorthChart {...input} />);
  expect(screen.getByText(/Valuation unavailable/i)).toBeInTheDocument();
  expect(screen.queryByLabelText("Net worth plot")).not.toBeInTheDocument();
  expect(screen.queryByText(/K0\.00/)).not.toBeInTheDocument();
});
it("labels supported summary amounts using their actual base currency", () => {
  const data = { totalAssets: 100, totalLiabilities: 0, netWorthValue: 100, currency: "USD" };
  render(<NetWorthSummary {...props} data={data} />);
  expect(screen.getByText(/USD.*100\.00/)).toBeInTheDocument();
  expect(screen.queryByText("K100.00")).not.toBeInTheDocument();
});
