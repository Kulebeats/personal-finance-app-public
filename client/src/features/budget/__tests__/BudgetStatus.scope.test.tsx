import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SettingsProvider } from "@/contexts/SettingsContext";
import BudgetStatusWidget from "@/components/dashboard/BudgetStatusWidget";

const apiCall = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiCall }));
vi.mock("@/hooks/use-settings", () => ({
  useDisplaySettings: () => ({ data: { currency: "USD", theme: "light", numberFormat: "US" } }),
}));

const zmw = (amount: string) => ({ amount, currency: "ZMW" });
const rows = [
  { id: "flex", isFlexBucket: true, amount: zmw("400.00"), spent: zmw("237.50") },
  { id: "legacy-group", categoryGroupId: "fixed", amount: zmw("500.00"), spent: zmw("120.00") },
  { id: "custom-category", categoryId: "parts", amount: zmw("100.00"), spent: zmw("75.00") },
];

it.each([
  ["flex", "K237.50", "K400.00"],
  ["category", "K195.00", "K600.00"],
] as const)("uses disjoint %s progress from the seeded budget caller", async (budgetSystem, spent, budget) => {
  apiCall.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith("/budgets/progress?")) return { success: true, data: rows, meta: { unavailableBudgets: [] } };
    if (path === "/budgets/settings") return { success: true, data: { budgetSystem, defaultApplyScope: "this_month" } };
    throw new Error("Unexpected synthetic endpoint");
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}><SettingsProvider><BudgetStatusWidget /></SettingsProvider></QueryClientProvider>);
  expect(await screen.findByText(spent, { exact: true })).toBeVisible();
  expect(screen.getByText(budget, { exact: true })).toBeVisible();
  expect(screen.queryByText("K432.50", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("K1,000.00", { exact: true })).not.toBeInTheDocument();
  expect(apiCall).toHaveBeenCalledWith("/budgets/settings");
});
