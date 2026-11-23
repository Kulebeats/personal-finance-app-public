/**
 * @vitest-environment jsdom
 *
 * NEW-34: the net-worth changes widget says why it has nothing to chart, and
 * says when a change covers a month with no snapshot.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportsNetWorthChangesResponse } from "@shared/reports";
import { NetWorthChangesWidget } from "../NetWorthChangesWidget";
import { NetWorthChangeWidget } from "../AnnualDashboardMonthlyWidgets";
import { getMockNetWorthChangesData } from "@/lib/mockReportsData";

const changes = vi.hoisted(() => ({ data: undefined as unknown, chartData: undefined as unknown, average: vi.fn() }));
vi.mock("@/hooks/use-reports", () => ({
  useCurrentYearRange: () => ({ from: "2026-01-01", to: "2026-12-31" }),
  useReportsNetWorthChanges: () => ({ data: changes.data, isLoading: false, error: null }),
}));
vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({ currency: "ZMW", formatCurrency: (amount: number) => `ZMW ${amount}` }),
}));
vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));
vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const BarChart = ({ children, data }: { children?: ReactNode; data?: unknown }) => {
    changes.chartData = data;
    return <div>{children}</div>;
  };
  return {
    BarChart, Bar: Stub, XAxis: Stub, YAxis: Stub, CartesianGrid: Stub, ResponsiveContainer: Stub, Cell: Stub,
    ReferenceLine: (props: unknown) => { changes.average(props); return null; },
  };
});

const zmw = (amount: string) => ({ amount, currency: "ZMW" });
const response = (overrides: Partial<ReportsNetWorthChangesResponse>): ReportsNetWorthChangesResponse => ({
  range: { from: "2026-01-01", to: "2026-12-31", currency: "ZMW" },
  totalChange: zmw("0.00"),
  avgMonthlyChange: null,
  periods: [],
  historyCoverage: "snapshots",
  insufficientHistory: true,
  missingMonths: [],
  ...overrides,
});

describe("NetWorthChangesWidget history captions", () => {
  afterEach(() => { cleanup(); changes.average.mockReset(); });

  it("with no snapshots, says none were recorded in this range", () => {
    changes.data = response({ historyCoverage: "current_only" });
    render(<NetWorthChangesWidget />);
    expect(screen.getByText("No snapshots were recorded in this range.")).toBeTruthy();
  });

  it("explains that the monthly comparison needs two different months", () => {
    changes.data = response({ historyCoverage: "snapshots", insufficientHistory: true });
    render(<NetWorthChangesWidget />);
    expect(screen.getByText(/from two different months are needed/)).toBeTruthy();
    expect(screen.queryByText("No snapshots were recorded in this range.")).toBeNull();
  });

  it("says when a change covers a month with no snapshot", () => {
    changes.data = response({
      insufficientHistory: false,
      missingMonths: ["2026-02"],
      totalChange: zmw("400.00"),
      periods: [{
        period: "2026-03-31", startPeriod: "2026-01-31", spansGap: true,
        startNetWorth: zmw("1000.00"), endNetWorth: zmw("1400.00"), change: zmw("400.00"), changePct: 40,
      }],
    });
    render(<NetWorthChangesWidget />);
    expect(screen.getByText(/1 month has no net worth snapshot/)).toBeTruthy();
  });

  it("labels a change across a gap with both months, and keeps where it started", () => {
    changes.data = response({
      insufficientHistory: false,
      missingMonths: ["2026-02"],
      totalChange: zmw("500.00"),
      periods: [
        { period: "2026-03-31", startPeriod: "2026-01-31", spansGap: true,
          startNetWorth: zmw("1000.00"), endNetWorth: zmw("1400.00"), change: zmw("400.00"), changePct: 40 },
        { period: "2026-04-30", startPeriod: "2026-03-31", spansGap: false,
          startNetWorth: zmw("1400.00"), endNetWorth: zmw("1500.00"), change: zmw("100.00"), changePct: 7.14 },
      ],
    });
    render(<NetWorthChangesWidget />);
    expect(changes.chartData).toMatchObject([
      { label: "Jan–Mar", period: "2026-03-31", startPeriod: "2026-01-31", spansGap: true, change: 400 },
      { label: "Apr", period: "2026-04-30", startPeriod: "2026-03-31", spansGap: false, change: 100 },
    ]);
  });

  it("uses the report's unit and the published monthly average in both widgets", () => {
    const usd = (amount: string) => ({ amount, currency: "USD" });
    changes.data = response({
      range: { from: "2026-01-01", to: "2026-03-31", currency: "USD" },
      insufficientHistory: false, missingMonths: ["2026-02"],
      totalChange: usd("400.00"), avgMonthlyChange: usd("200.00"),
      periods: [{
        period: "2026-03-31", startPeriod: "2026-01-31", spansGap: true,
        startNetWorth: usd("1000.00"), endNetWorth: usd("1400.00"), change: usd("400.00"), changePct: 40,
      }],
    });
    render(<><NetWorthChangesWidget /><NetWorthChangeWidget /></>);
    expect(screen.getByText("+$200")).toBeInTheDocument();
    expect(changes.chartData).toMatchObject([{ label: "Jan–Mar", value: 400 }]);
    expect(changes.average).toHaveBeenCalledWith(expect.objectContaining({
      y: 200, label: expect.objectContaining({ value: "Avg/Month: $200" }),
    }));
  });

  it("keeps an unavailable average and an unknown display unit explicit", () => {
    changes.data = response({
      range: { from: "2026-01-01", to: "2026-03-31", currency: "" },
      insufficientHistory: false,
      totalChange: { amount: "400.00", currency: "" },
      periods: [{
        period: "2026-03-31", startPeriod: "2026-01-31", spansGap: true,
        startNetWorth: zmw("1000.00"), endNetWorth: zmw("1400.00"), change: zmw("400.00"), changePct: 40,
      }],
    });
    render(<><NetWorthChangesWidget /><NetWorthChangeWidget /></>);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(screen.queryByText(/ZMW\s*400/)).not.toBeInTheDocument();
    expect(changes.average).not.toHaveBeenCalled();
  });

  it("renders the dev mock with in-range capture dates and the report currency", () => {
    const from = "2024-01-12", to = "2024-03-02";
    const mock = getMockNetWorthChangesData({ from, to });
    expect(mock.range).toEqual({ from, to, currency: "ZMW" });
    expect(mock.periods).toMatchObject([
      { startPeriod: "2024-01-31", period: "2024-02-29" },
      { startPeriod: "2024-02-29", period: "2024-03-02" },
    ]);
    expect(Number(mock.avgMonthlyChange?.amount)).toBeCloseTo(Number(mock.totalChange.amount) / 2, 2);
    changes.data = mock;
    render(<><NetWorthChangesWidget /><NetWorthChangeWidget /></>);
    expect(changes.chartData).toMatchObject([{ label: "Feb" }, { label: "Mar" }]);
  });

  it("keeps old month labels readable when range metadata is absent", () => {
    const { range: _range, ...legacy } = response({
      insufficientHistory: false,
      totalChange: zmw("400.00"),
      periods: [{
        period: "Jan", startNetWorth: zmw("1000.00"),
        endNetWorth: zmw("1400.00"), change: zmw("400.00"), changePct: 40,
      }],
    });
    changes.data = legacy;
    render(<><NetWorthChangesWidget /><NetWorthChangeWidget /></>);
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(changes.chartData).toMatchObject([{ label: "Jan" }]);
  });
});
