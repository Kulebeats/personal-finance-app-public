import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { PerformanceDataPoint } from "@shared/investment-performance";
import { InvestmentPerformance } from "../InvestmentPerformance";

type ChartPoint = PerformanceDataPoint & { plotValue: number };
const chart = vi.hoisted(() => ({ data: [] as ChartPoint[] }));
vi.mock("@/hooks/use-settings", () => ({
  useDisplaySettings: () => ({ data: { numberFormat: "EU" } }),
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  AreaChart: ({ children, data }: { children: ReactNode; data: ChartPoint[] }) => {
    chart.data = data;
    return <svg>{children}</svg>;
  },
  Area: () => null,
  XAxis: () => null,
  YAxis: ({ tickFormatter }: { tickFormatter: (value: number) => string }) =>
    <text>{tickFormatter(1000)}</text>,
  Tooltip: ({ formatter }: {
    formatter: (value: number, name: string, item: { payload: ChartPoint }) => [string, string];
  }) => {
    const payload = chart.data[0];
    const [label] = formatter(payload.plotValue, "plotValue", { payload });
    return <text>{label}</text>;
  },
}));

it.each([
  ["USD", "$90.071.992.547.409,93"],
  ["T?S", "T?S90.071.992.547.409,93"],
])("shows exact %s amounts with the viewer's number format", (currency, label) => {
  const value = { amount: "90071992547409.93", currency };
  render(<InvestmentPerformance
    data={[{ date: "2026-10-01", value }]}
    timeframe="ALL"
    onTimeframeChange={vi.fn()}
    displayCurrency="ZMW"
    formatCurrency={vi.fn()}
    totalGainLossPercent={null}
  />);

  expect(chart.data[0]).toMatchObject({ value, plotValue: 90071992547409.94 });
  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByText(`${currency} 1k`)).toBeInTheDocument();
});
