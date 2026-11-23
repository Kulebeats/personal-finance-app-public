/**
 * N3 (owner ruling, 20 Nov): the section's spent total counts spending in
 * categories without a limit, shown on its own "Unbudgeted" line.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BudgetSection } from "../components/BudgetSection";
import { BudgetSummaryCard } from "../components/BudgetSummaryCard";
import { buildBudgetGroupsFromApi, buildFlexDisplayGroups, calculateBudgetTotals } from "../hooks/budgetGroupUtils";
import type { Category, CategoryGroup } from "@/hooks/use-settings";
import type { BudgetWithProgress } from "@/hooks/useBudgets";
import { QueryClient } from "@tanstack/react-query";
import { storeUnbudgetedSpend, unbudgetedSpendKey } from "@/hooks/useUnbudgetedSpend";
import type { BudgetGroup } from "../types";

vi.mock("@/contexts/SettingsContext", () => {
  const format = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return { useFormatters: () => ({ formatCurrency: (val: number) => `K${format.format(val)}` }) };
});

const icon = () => <span>$</span>;
const groups: BudgetGroup[] = [{
  id: "grp-1",
  name: "Everyday",
  type: "expense",
  expanded: true,
  items: [{ id: "c1", name: "Groceries", icon, budget: 1000, actual: 100, remaining: 900 }],
}];
const props = {
  title: "Expenses",
  groups,
  onToggleGroup: vi.fn(),
  onAddItemToGroup: vi.fn(),
  onUpdateItem: vi.fn(),
  showUnbudgeted: false,
  onToggleShowUnbudgeted: vi.fn(),
};

const zmw = (amount: string) => ({ amount, currency: "ZMW" });
const groupRecord = (partial: Partial<CategoryGroup>): CategoryGroup => ({
  id: "group", householdId: "household", name: "Studio", type: "expenses", budgetMode: "by_group",
  rolloverEnabled: false, isArchived: false, displayOrder: 0, createdAt: "", updatedAt: "", ...partial,
});
const category = (partial: Partial<Category>): Category => ({
  id: "cat", householdId: "household", groupId: "group", name: "Parts", includeInBudget: true,
  icon: null, color: null, isArchived: false, displayOrder: 0, createdAt: "", updatedAt: "", ...partial,
});
const progress = (partial: Partial<BudgetWithProgress>): BudgetWithProgress => ({
  id: "limit", householdId: "household", name: "Group limit", categoryGroupId: "group", amount: zmw("500.00"),
  spent: zmw("120.00"), remaining: zmw("380.00"), percentUsed: 24, period: "monthly",
  rolloverEnabled: false, isActive: true, createdAt: "", updatedAt: "", ...partial,
});

describe("BudgetSection unbudgeted spending", () => {
  it("uses the group-only progress row when category records carry no spending fields", () => {
    const rows = buildBudgetGroupsFromApi([progress({})], [category({})], [groupRecord({})]);
    expect(calculateBudgetTotals(rows)).toMatchObject({ totalExpenseBudget: 500, totalExpenseActual: 120, expenseRemaining: 380 });
  });

  it.each(["Fixed", "Studio", "Non-Monthly repairs"])("carries the %s limit and spend through the section, summary and flex display", (name) => {
    const rows = buildBudgetGroupsFromApi(
      [progress({}), progress({ id: "legacy-child", categoryGroupId: null, categoryId: "cat", spent: zmw("87.00") }),
        progress({ id: "zero", categoryGroupId: null, categoryId: "limit-zero", amount: zmw("0.00"), spent: zmw("0.00") })],
      [category({ spent: 120 }), category({ id: "open", groupId: "open-group", name: "Open category" }),
        category({ id: "limit-zero", groupId: "open-group", name: "Zero limit" }),
        category({ id: "deleted", groupId: "open-group", deletedAt: "2026-10-01" })],
      [groupRecord({ name, type: name === "Fixed" ? "expense" : "expenses" }),
        groupRecord({ id: "open-group", name: "Other", budgetMode: "by_category" })],
    );
    const unbudgetedSpent = zmw("42.50");
    const totals = calculateBudgetTotals(rows, { expense: unbudgetedSpent });
    expect(totals).toMatchObject({ totalExpenseActual: 162.5, totalExpenseBudget: 500, expenseRemaining: 337.5 });
    const projected = buildFlexDisplayGroups({ groups: rows });
    expect(calculateBudgetTotals(projected, { expense: unbudgetedSpent })).toMatchObject({
      totalExpenseActual: 162.5, totalExpenseBudget: 500, expenseRemaining: 337.5,
    });

    render(<><BudgetSection {...props} groups={rows} unbudgetedSpent={unbudgetedSpent} />
      <BudgetSummaryCard {...totals} incomeGroups={[]} expenseGroups={rows} summaryTab="expenses" onTabChange={vi.fn()} /></>);
    expect(screen.getByText("K162.50")).toBeVisible();
    expect(screen.getByText("K120.00 spent")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show 1 unbudgeted" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Parts budget category, included in group/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /Zero limit budget category/ })).toBeVisible();

    const { container } = render(<BudgetSection {...props} title="Flex-mode expenses" groups={projected} unbudgetedSpent={unbudgetedSpent}
      onUpdateGroupBudget={vi.fn()} onCommitGroupBudget={vi.fn()} />);
    const flexSection = within(container);
    const header = within(flexSection.getByText("Flex-mode expenses").parentElement!.parentElement!);
    expect(header.getByText("K500.00")).toBeVisible();
    expect(header.getByText("K162.50")).toBeVisible();
    expect(header.getByText("K337.50")).toBeVisible();
    const projectedName = name.startsWith("Non-Monthly") ? "Non-Monthly" : "Fixed";
    const projectedGroup = within(flexSection.getByRole("button", { name: `${projectedName} budget group, expanded` }).parentElement!);
    expect(projectedGroup.getByText("K500.00")).toBeVisible();
    expect(projectedGroup.getByText("K120.00")).toBeVisible();
    expect(projectedGroup.getByText("K380.00")).toBeVisible();
    expect(projectedGroup.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps an explicitly configured zero group limit without any visible child rows", () => {
    const rows = buildBudgetGroupsFromApi(
      [progress({ amount: zmw("0.00"), spent: zmw("0.00"), remaining: zmw("0.00") })], [], [groupRecord({})],
    );
    const projected = buildFlexDisplayGroups({ groups: rows });
    expect(projected.find(group => group.name === "Fixed")).toMatchObject({ budget: 0, actual: 0, items: [] });
    expect(calculateBudgetTotals(projected).expenseRemaining).toBe(0);
    render(<BudgetSection {...props} groups={projected} currency="ZMW" />);
    const header = within(screen.getByText("Expenses").parentElement!.parentElement!);
    expect(header.getAllByText("K0.00")).toHaveLength(3);
  });

  it.each(["Fixed", "Non-Monthly"])("shows the withheld %s limit as unavailable and any known subtotal as partial", (name) => {
    const hiddenGroup = groupRecord({ name });
    const knownGroup = groupRecord({ id: "known-group", name: `${name} known` });
    const withheld = [{
      id: "foreign", name, categoryGroupId: hiddenGroup.id, categoryId: null, currency: "USD",
      reason: { code: "BUDGET_CURRENCY_MISMATCH", message: "Limit unavailable" },
    }];
    const rows = buildBudgetGroupsFromApi([], [category({})], [hiddenGroup], withheld, "ZMW");
    const { rerender } = render(<BudgetSection {...props} currency="ZMW"
      groups={buildFlexDisplayGroups({ groups: rows, currency: "ZMW" })} onUpdateGroupBudget={vi.fn()} />);

    const sectionHeader = () => within(screen.getByText("Expenses").parentElement!.parentElement!);
    const groupHeader = () => within(screen.getByRole("button", { name: `${name} budget group, expanded` }).parentElement!);
    expect(sectionHeader().getByText("Unavailable")).toBeVisible();
    expect(sectionHeader().getByText("At least K0.00")).toBeVisible();
    expect(sectionHeader().getByText("Incomplete")).toBeVisible();
    expect(groupHeader().getByText("Unavailable")).toBeVisible();
    expect(groupHeader().getByText("Incomplete")).toBeVisible();
    expect(groupHeader().queryByRole("textbox")).not.toBeInTheDocument();
    const flexibleHeader = within(screen.getByRole("button", { name: "Flexible budget group, expanded" }).parentElement!);
    expect(flexibleHeader.getByPlaceholderText("Unbudgeted")).toHaveValue("");

    const mixedRows = buildBudgetGroupsFromApi(
      [progress({ categoryGroupId: knownGroup.id })], [category({})], [hiddenGroup, knownGroup], withheld, "ZMW",
    );
    rerender(<BudgetSection {...props} currency="ZMW" groups={buildFlexDisplayGroups({ groups: mixedRows, currency: "ZMW" })} />);
    for (const header of [sectionHeader(), groupHeader()]) {
      expect(header.getByText("At least K500.00")).toBeVisible();
      expect(header.getByText("At least K120.00")).toBeVisible();
      expect(header.getByText("Incomplete")).toBeVisible();
    }
  });

  it("keeps a covered but unavailable group out of the unbudgeted count and marks the actual incomplete", () => {
    const group = groupRecord({});
    const rows = buildBudgetGroupsFromApi([], [category({})], [group], [{
      id: "foreign", name: group.name, categoryGroupId: group.id, categoryId: null, currency: "USD",
      reason: { code: "BUDGET_CURRENCY_MISMATCH", message: "Limit unavailable" },
    }]);
    render(<BudgetSection {...props} groups={rows} unbudgetedSpent={zmw("42.50")} />);
    expect(screen.getByText("At least K42.50")).toBeVisible();
    expect(screen.queryByRole("button", { name: /unbudgeted$/ })).not.toBeInTheDocument();
  });
  it("shows the unbudgeted line and counts it in the section's spent total; the budget row is unchanged", () => {
    render(<BudgetSection {...props} unbudgetedSpent={{ amount: "42.50", currency: "ZMW" }} />);
    const line = screen.getByLabelText("Unbudgeted, K42.50 spent in categories without a limit");
    expect(line).toHaveTextContent("Unbudgeted");
    expect(line).toHaveTextContent("K42.50");
    expect(screen.getByText("K142.50")).toBeInTheDocument();
    expect(screen.getByLabelText(/Groceries budget category, K1,000.00 budgeted, K100.00 spent/)).toBeInTheDocument();
  });

  it("shows no line when nothing was spent outside a budget", () => {
    render(<BudgetSection {...props} unbudgetedSpent={{ amount: "0.00", currency: "ZMW" }} />);
    expect(screen.queryByText("Unbudgeted")).not.toBeInTheDocument();
  });

  it("adds the unbudgeted spending to the page's expense total", () => {
    const totals = calculateBudgetTotals(groups, { expense: { amount: "42.50", currency: "ZMW" }, income: null });
    expect(totals.totalExpenseActual).toBe(142.5);
  });

  it("shows the line as unavailable and the section total as incomplete when the server reports null (missing rate)", () => {
    render(<BudgetSection {...props} unbudgetedSpent={null} />);
    const line = screen.getByLabelText("Unbudgeted spending unavailable: an exchange rate is missing, so the Expenses total is incomplete");
    expect(line).toHaveTextContent("Unavailable");
    expect(screen.getByText("At least K100.00")).toHaveAccessibleName(/Expenses total is incomplete/);
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
  });

  it("marks the summary card's expense total incomplete instead of a precise figure", () => {
    render(<BudgetSummaryCard totalIncomeBudget={null} totalIncomeActual={0} totalExpenseBudget={1000} totalExpenseActual={100}
      incomeRemaining={null} expenseRemaining={900} incomeGroups={[]} expenseGroups={groups} summaryTab="summary"
      onTabChange={vi.fn()} isExpenseActualIncomplete />);
    expect(screen.getByText("At least K100.00 spent")).toHaveAccessibleName(/total incomplete because an exchange rate is missing/);
    expect(screen.queryByText("K900.00 remaining")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: /Expenses progress/ })).not.toBeInTheDocument();
  });
});

describe("Budget Summary reports the planned difference only when both limits are known", () => {
  const income: BudgetGroup = { id: "planned-income", name: "Salary", type: "income", budget: 1500, actual: 1800, items: [] };
  const expense: BudgetGroup = { id: "planned-expense", name: "Flexible", type: "expense", budget: 1000, actual: 100, items: [] };
  const summary = (incomeGroups: BudgetGroup[], expenseGroups: BudgetGroup[], currency: string | null, summaryTab: "summary" | "expenses" = "summary") => (
    <BudgetSummaryCard {...calculateBudgetTotals([...incomeGroups, ...expenseGroups])} incomeGroups={incomeGroups} expenseGroups={expenseGroups}
      currency={currency} summaryTab={summaryTab} onTabChange={vi.fn()} />
  );
  const header = () => within(screen.getByText("Left to budget").parentElement!);

  it("reports the complete planned difference and distinguishes a genuine absent limit from configured zero", () => {
    const { rerender } = render(summary([income], [expense], "ZMW"));
    expect(header().getByText("K500.00")).toBeVisible();
    expect(header().queryByText("K1,700.00")).not.toBeInTheDocument();
    rerender(summary([{ ...income, budget: null }], [{ ...expense, budget: null }], "ZMW"));
    expect(header().getByText("Unbudgeted")).toBeVisible();
    rerender(summary([{ ...income, budget: 0 }], [{ ...expense, budget: 0 }], "ZMW"));
    expect(header().getByText("K0.00")).toBeVisible();
    expect(screen.getAllByText("K0.00 budget")).toHaveLength(2);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it.each(["income", "expense"] as const)("withholds the planned difference for partial %s without hiding known actuals", type => {
    const partialExpense = { ...expense, hasWithheldLimit: type === "expense" };
    const partialIncome = { ...income, hasWithheldLimit: type === "income" };
    const { rerender } = render(summary([partialIncome], [partialExpense], "ZMW"));
    expect(header().getByText("Unavailable")).toBeVisible();
    expect(header().queryByText(/K500\.00|At least/)).not.toBeInTheDocument();
    expect(screen.getByText(type === "income" ? "At least K1,500.00 budget" : "At least K1,000.00 budget")).toBeVisible();
    expect(screen.getByText(type === "income" ? "K1,800.00 earned" : "K100.00 spent")).toBeVisible();
    expect(screen.queryByRole("progressbar", { name: type === "income" ? /Income progress/ : /Expenses progress/ })).not.toBeInTheDocument();

    rerender(summary([partialIncome], [{ ...partialExpense, budget: null, hasWithheldLimit: true }], "ZMW", "expenses"));
    expect(screen.queryByText("Unbudgeted")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("K900.00 remaining")).not.toBeInTheDocument();
  });

  it("withholds remaining amounts and progress in unknown units while preserving the complete plan after an actual-only gap", () => {
    const { rerender } = render(summary([income], [expense], null));
    expect(header().getByText("Unavailable")).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/K900\.00 remaining|K100\.00 spent/)).not.toBeInTheDocument();
    rerender(summary([income], [{ ...expense, actualIncomplete: true }], "ZMW", "expenses"));
    expect(header().getByText("K500.00")).toBeVisible();
    expect(screen.getByText("K1,000.00 budget")).toBeVisible();
    expect(screen.getByText("At least K100.00 spent")).toBeVisible();
    expect(screen.queryByText("K900.00 remaining")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

it("keeps withheld real Flex distinct from a partial legacy fallback and a valid zero bucket", () => {
  const variable = { ...groups[0], hasWithheldLimit: true, actualIncomplete: true };
  const projection = (flex: Partial<Parameters<typeof buildFlexDisplayGroups>[0]>) => buildFlexDisplayGroups({
    groups: [variable], currency: "ZMW", ...flex,
  });
  const section = (flex: Partial<Parameters<typeof buildFlexDisplayGroups>[0]>) => (
    <BudgetSection {...props} currency="ZMW" groups={projection(flex)} onUpdateGroupBudget={vi.fn()} onCommitGroupBudget={vi.fn()} />
  );
  const flexHeader = () => within(screen.getByRole("button", { name: "Flexible budget group, expanded" }).parentElement!);

  const { rerender } = render(section({ hasWithheldFlexLimit: true }));
  expect(flexHeader().getByText("Unavailable")).toBeVisible();
  expect(flexHeader().queryByRole("textbox")).not.toBeInTheDocument();
  expect(flexHeader().getByText("At least K100.00")).toBeVisible();
  expect(flexHeader().getByText("Incomplete")).toBeVisible();

  rerender(section({}));
  expect(flexHeader().getByText("At least K1,000.00")).toBeVisible();
  expect(flexHeader().getByRole("textbox")).toHaveValue("");
  expect(flexHeader().getByText("Incomplete")).toBeVisible();

  rerender(section({ flexBudgetId: "visible-flex", flexBudgetAmount: 0 }));
  expect(flexHeader().getByRole("textbox")).toHaveValue("0");
  expect(flexHeader().queryByText("At least K1,000.00")).not.toBeInTheDocument();
  expect(flexHeader().getByText("At least K100.00")).toBeVisible();
  expect(flexHeader().getByText("Incomplete")).toBeVisible();
});

describe("storeUnbudgetedSpend keeps not-reported, reported and unavailable apart", () => {
  it("stores null and malformed values as unavailable, an absent value as not reported, and zero as reported", () => {
    const queryClient = new QueryClient();
    storeUnbudgetedSpend(queryClient, 2026, 2, { unbudgetedSpent: { expense: null, income: { amount: "0.00", currency: "ZMW" } } });
    expect(queryClient.getQueryData(unbudgetedSpendKey(2026, 2))).toEqual({ expense: null, income: { amount: "0.00", currency: "ZMW" } });
    storeUnbudgetedSpend(queryClient, 2026, 3, { unbudgetedSpent: { expense: { amount: 42.5 } } });
    expect(queryClient.getQueryData(unbudgetedSpendKey(2026, 3))).toEqual({ expense: null, income: undefined });
    storeUnbudgetedSpend(queryClient, 2026, 4, {});
    expect(queryClient.getQueryData(unbudgetedSpendKey(2026, 4))).toEqual({ expense: undefined, income: undefined });
  });
});
