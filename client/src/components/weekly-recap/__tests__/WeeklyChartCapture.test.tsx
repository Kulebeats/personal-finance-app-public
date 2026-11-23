/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import WeeklyChart from "../components/WeeklyChart";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Area: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null,
}));
vi.mock("@/contexts/SettingsContext", async () => {
  const { formatDate } = await import("@/lib/format");
  return { useFormatters: () => ({ formatCurrency: (value: number) => `USD ${value}`,
    formatDate: (date: Date | string) => formatDate(date, "YYYY-MM-DD"),
  }) };
});
it("describes captured worth with its dates and denomination in the chart and accessible table", () => {
  render(<WeeklyChart title="Captured worth" currency="ZMW" data={[
    { date: "2026-10-30", value: 900, currency: "ZMW" }, { date: "2026-10-31", value: 988.89, currency: "ZMW" },
  ]} />);
  expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/ZMW.*900.*2026-10-30.*ZMW.*988\.89.*2026-10-31/);
  expect(screen.getByRole("table")).toHaveTextContent(/2026-10-31.*ZMW.*988\.89/);
  expect(screen.getByRole("table")).not.toHaveTextContent("USD");
});
