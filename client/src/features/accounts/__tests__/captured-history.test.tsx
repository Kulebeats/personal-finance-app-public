/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { NetWorthChart } from "../components/NetWorthChart";

type TooltipValue = (value: number, name: string, item: { payload: { currency: string } }) => unknown;
const callbacks = vi.hoisted(() => ({ format: undefined as undefined | TooltipValue,
  label: undefined as undefined | ((date: string) => string), tick: undefined as undefined | ((date: string) => string) }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div aria-label="Net worth plot">{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <svg>{children}</svg>, Area: () => null, YAxis: () => null,
  XAxis: ({ tickFormatter }: { tickFormatter: (date: string) => string }) => { callbacks.tick = tickFormatter; return null; },
  Tooltip: ({ formatter, labelFormatter }: { formatter: TooltipValue; labelFormatter?: (date: string) => string }) => {
    callbacks.format = formatter; callbacks.label = labelFormatter; return null;
  },
}));
beforeEach(() => { callbacks.format = undefined; callbacks.label = undefined; callbacks.tick = undefined; });
const point = { date: "2026-10-31", value: 50, assets: 50, liabilities: 0, currency: "ZMW", provenance: "captured_snapshot" as const };

// Run the same mounted cases under TZ=America/Los_Angeles to verify the actual
// negative-offset runtime. No in-worker TZ mutation or mocked date formatter.
it("keeps both captured currencies and their calendar labels independently of current USD", () => {
  const data = [point, { ...point, date: "2026-11-01", currency: "USD", value: 20 }];
  render(<NetWorthChart data={data} currency="USD" currentNetWorth={100} isLoading={false} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Historical currency" }), { target: { value: "ZMW" } });
  expect(String(callbacks.format?.(50, "Net Worth", { payload: { currency: "ZMW" } }))).toMatch(/ZMW.*50\.00/);
  const calendar = new Date(2026, 9, 31, 12);
  expect(callbacks.label?.("2026-10-31")).toBe(new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(calendar));
  expect(callbacks.tick?.("2026-10-31")).toBe(new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(calendar));
  expect(screen.getByRole("table")).toHaveTextContent(/ZMW.*50\.00/);
  expect(screen.getByRole("table")).toHaveTextContent(/USD.*20\.00/);
  expect(screen.getByText(/USD.*100\.00/)).toBeInTheDocument();
});
it("retains supported captured history when current valuation is unavailable", () => {
  render(<NetWorthChart data={[point]} currency="USD" currentNetWorth={0} unavailable isLoading={false} />);
  expect(screen.getByText(/Valuation unavailable/i)).toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveTextContent(/ZMW.*50\.00/);
  expect(screen.getByLabelText("Net worth plot")).toBeInTheDocument();
});
it("marks unproven independent history without plotting a relabelled number", () => {
  render(<NetWorthChart data={[{ date: "2026-10-31", value: 123456, assets: 123456, liabilities: 0 }]}
    currency="USD" currentNetWorth={100} isLoading={false} />);
  expect(screen.getByText(/No proven snapshots in this range/i)).toBeInTheDocument();
  expect(screen.getByText(/Independent balance history has unverified denomination/i)).toBeInTheDocument();
  expect(screen.queryByLabelText("Net worth plot")).not.toBeInTheDocument();
});
it("keeps the range control mounted and focused while access is revalidated", () => {
  const control = <button>Choose range</button>;
  const view = render(<NetWorthChart data={[point]} currency="USD" currentNetWorth={100} isLoading={false}>{control}</NetWorthChart>);
  const button = screen.getByRole("button", { name: "Choose range" }); button.focus();
  view.rerender(<NetWorthChart data={[]} currency="USD" currentNetWorth={100} isLoading={false} historyState="checking">{control}</NetWorthChart>);
  expect(screen.getByRole("button", { name: "Choose range" })).toBe(button);
  expect(button).toHaveFocus();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
