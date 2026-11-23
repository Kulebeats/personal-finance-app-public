import { within, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/contexts/SettingsContext";
import type { Category, CategoryGroup } from "@/hooks/use-settings";
import type { BudgetWithProgress } from "@/hooks/useBudgets";
import BudgetStatusWidget from "@/components/dashboard/BudgetStatusWidget";
import { BudgetSection } from "../components/BudgetSection";
import { BudgetDetailModal } from "../components/BudgetDetailModal";
import { BudgetSummaryCard } from "../components/BudgetSummaryCard";
import { buildBudgetGroupsFromApi, calculateBudgetTotals } from "../hooks/budgetGroupUtils";

const useCurrentMonthBudgets = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useBudgets", () => ({ useCurrentMonthBudgets }));
vi.mock("@/hooks/use-settings", () => ({
  useDisplaySettings: () => ({ data: { currency: "USD", theme: "light", numberFormat: "US" } }),
}));
vi.mock("../hooks/useBudgetCategoryHistory", () => ({
  useBudgetCategoryHistory: () => ({ points: [], average: 0, isLoading: false, hasData: false }),
}));

const money = (amount: string, currency = "ZMW") => ({ amount, currency });
const budget: BudgetWithProgress = {
  id: "limit", householdId: "household", name: "Groceries", categoryId: "groceries",
  amount: money("500.00"), spent: money("620.00"), remaining: money("-120.00"), percentUsed: 124,
  period: "monthly", rolloverEnabled: false, isActive: true, createdAt: "", updatedAt: "",
};
const category: Category = {
  id: "groceries", householdId: "household", groupId: "grocery-group", name: "Groceries", icon: null, color: null,
  displayOrder: 0, includeInBudget: true, isArchived: false, createdAt: "", updatedAt: "",
};
const group: CategoryGroup = {
  id: "grocery-group", householdId: "household", name: "Food", type: "expenses", budgetMode: "by_category",
  isArchived: false, displayOrder: 0, rolloverEnabled: false, createdAt: "", updatedAt: "",
};
const month = { year: 2026, month: 11 };

describe("budget MoneyDto denomination with a USD display preference", () => {
  afterEach(() => useCurrentMonthBudgets.mockReset());

  it("keeps ZMW in the budget row, detail input, group header and summary", () => {
    const groups = buildBudgetGroupsFromApi([budget], [category], [group]);
    const totals = calculateBudgetTotals(groups, { expense: money("17.50") });
    render(<SettingsProvider>
      <BudgetSection title="Expenses" groups={groups} onAddItemToGroup={vi.fn()} onToggleGroup={vi.fn()}
        onUpdateItem={vi.fn()} showUnbudgeted={false} onToggleShowUnbudgeted={vi.fn()} unbudgetedSpent={money("17.50")}
        currency="ZMW" />
      <BudgetSummaryCard {...totals} incomeGroups={[]} expenseGroups={groups} onTabChange={vi.fn()} summaryTab="summary" currency="ZMW" />
      <BudgetDetailModal selected={{ groupId: group.id, itemId: category.id, groupName: group.name, item: groups[0].items[0] }}
        groups={groups} {...month} onClose={vi.fn()} onUpdate={vi.fn()} />
    </SettingsProvider>);

    const row = screen.getByRole("button", { name: /Groceries budget category, K500\.00 budgeted, K620\.00 spent/ });
    expect(within(row).getByText("-K120.00")).toBeVisible();
    expect(within(row).getByRole("textbox", { name: "Budget amount for Groceries" }).parentElement).toHaveTextContent("K");
    const detail = screen.getByRole("textbox", { name: "Monthly budget amount" });
    expect(detail.parentElement).toHaveTextContent("K");
    expect(detail).toHaveValue("500");
    expect(screen.getAllByText("K620.00")).toHaveLength(3);
    expect(screen.getByText("K637.50 spent")).toBeVisible();
    expect(screen.getByText("K137.50 over")).toBeVisible();
    expect(screen.queryByText(/\$620\.00|\$137\.50/)).not.toBeInTheDocument();
  });

  it("shows over-budget progress in ZMW on the dashboard", () => {
    useCurrentMonthBudgets.mockReturnValue({ data: [budget], isLoading: false });
    render(<SettingsProvider><BudgetStatusWidget /></SettingsProvider>);
    expect(screen.getByText("K620.00")).toBeVisible();
    expect(screen.getByText("K500.00")).toBeVisible();
    expect(screen.getByText("You are over budget.")).toBeVisible();
  });

  it("withholds an aggregate whose budget and spending units differ", () => {
    useCurrentMonthBudgets.mockReturnValue({ data: [{ ...budget, spent: money("620.00", "USD") }], isLoading: false });
    render(<SettingsProvider><BudgetStatusWidget /></SettingsProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("Budget status unavailable");
    expect(screen.queryByText(/You are over budget|You've spent/)).not.toBeInTheDocument();
  });

  it("does not present an available total when progress set a budget aside", () => {
    useCurrentMonthBudgets.mockReturnValue({ data: [budget], unavailableBudgets: [{ id: "unavailable" }], isLoading: false });
    render(<SettingsProvider><BudgetStatusWidget /></SettingsProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("Budget status unavailable");
    expect(screen.queryByText("You are on track.")).not.toBeInTheDocument();
  });
});
