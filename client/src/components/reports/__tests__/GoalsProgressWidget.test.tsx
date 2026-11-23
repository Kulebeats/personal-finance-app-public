/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReportsGoalsProgressResponse } from "@shared/reports";
import { GoalsProgressWidget } from "../GoalsProgressWidget";

const eur = (amount: string) => ({ amount, currency: "EUR" });
const gbp = (amount: string) => ({ amount, currency: "GBP" });
const activeDebt = { type: "pay_down" as const, targetAmount: eur("0.00"),
  progressAvailability: "available" as const, onTrack: true };
const data: ReportsGoalsProgressResponse = {
  goals: [
    { ...activeDebt, id: "half", name: "Half repaid debt", currentAmount: eur("500.25"), progress: 50 },
    { ...activeDebt, id: "paid", name: "Fully repaid debt", currentAmount: eur("0.00"), progress: 100 },
    { id: "private", name: "Private debt", type: "pay_down", currentAmount: null, targetAmount: null,
      progress: null, progressAvailability: "unavailable", onTrack: null },
    { id: "savings", name: "Rainy day savings", type: "save_up", currentAmount: gbp("200.00"), targetAmount: gbp("1000.00"),
      progress: 20, progressAvailability: "available", onTrack: true },
  ],
  summary: { totalGoals: 4, onTrackCount: 3, behindCount: 0, completedCount: 1 },
};

vi.mock("@/hooks/use-reports", () => ({
  useReportsGoalsProgress: () => ({ data, isLoading: false, error: null }),
}));
vi.mock("@/contexts/SettingsContext", () => ({ useFormatters: () => ({ currency: "GBP" }) }));

afterEach(cleanup);

it("shows debt remaining in its native currency and keeps the savings and unavailable rows", () => {
  render(<GoalsProgressWidget />);

  expect(screen.getByText("50%")).toBeDefined();
  expect(screen.getByText("100%")).toBeDefined();
  expect(screen.getByText("€500.25 remaining")).toBeDefined();
  expect(screen.getByText("€0.00 remaining")).toBeDefined();
  expect(screen.getByText("Private debt")).toBeDefined();
  expect(screen.getByText("Progress unavailable: it includes sources you cannot see.")).toBeDefined();
  expect(screen.getAllByText(/ saved$/).map(label => label.textContent)).toEqual(["£200 saved"]);
  expect(screen.getAllByText(/^of /).map(label => label.textContent)).toEqual(["of £1,000"]);
});
