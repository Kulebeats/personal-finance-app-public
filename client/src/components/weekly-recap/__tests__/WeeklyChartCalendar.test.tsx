/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/contexts/SettingsContext";
import WeeklyChart from "../components/WeeklyChart";

const callbacks = vi.hoisted(() => ({ tooltip: undefined as undefined | ((date: string) => string), tick: undefined as undefined | ((date: string) => string) }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Area: () => null, YAxis: () => null,
  XAxis: ({ tickFormatter }: { tickFormatter: (date: string) => string }) => { callbacks.tick = tickFormatter; return null; },
  Tooltip: ({ labelFormatter }: { labelFormatter: (date: string) => string }) => { callbacks.tooltip = labelFormatter; return null; },
}));
vi.mock("@/hooks/use-settings", () => ({ useDisplaySettings: () => ({ data: {
  theme: "light", currency: "USD", dateFormat: "MM/DD/YYYY", numberFormat: "US",
}, isLoading: false }) }));
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => { vi.unstubAllGlobals(); });
// Launch this same mounted case with TZ=America/Los_Angeles for the negative
// offset regression. Changing TZ inside a running Windows worker is ineffective.
// The ordinary full suite also verifies the invariant in its actual runtime zone.
it("keeps the captured calendar day through real settings formatting in the process timezone", () => {
  render(<SettingsProvider><WeeklyChart title="Captured worth" currency="ZMW" data={[
    { date: "2026-10-31", value: 988.89, currency: "ZMW" },
  ]} /></SettingsProvider>);
  expect(callbacks.tick?.("2026-10-31")).toBe("Sat");
  expect(callbacks.tooltip?.("2026-10-31")).toBe("10/31/2026");
  expect(screen.getByRole("table")).toHaveTextContent("10/31/2026");
  expect(screen.getByRole("table")).not.toHaveTextContent("10/30/2026");
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain("10/31/2026");
});
