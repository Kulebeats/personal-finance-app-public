import React from "react";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BudgetForecastData } from "@/hooks/useBudgets";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

const mockUseBudgetProgress = vi.fn();
const mockUseBudgetSettings = vi.fn();
const mockUseUpdateBudgetSettings = vi.fn();
const mockUseRecalculateBudgets = vi.fn();
const mockUseClearBudgets = vi.fn();
const mockUseUpdateBudget = vi.fn();
const mockUseCreateBudget = vi.fn();
const mockUseBudgetForecast = vi.fn();
const mockUseUpdateBudgetForecast = vi.fn();
const mockUseMoveBudgetAmount = vi.fn();
const mockEnsureFlexBudget = vi.fn();

const mockUseCategories = vi.fn();
const mockUseGoals = vi.fn();

(globalThis as any).React = React;

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock(
  "@assets/generated_images/modern_abstract_butterfly_finance_logo.png",
  () => ({
    default: "logo.png",
  })
);

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

// These existing editor tests do not authorize a preview request.
vi.mock("@/contexts/SessionContext", () => ({
  useSession: () => ({ status: null, lifetime: null, loading: true }),
}));

vi.mock("@/hooks/useBudgets", () => ({
  // BudgetDetailModal's useBudgetCategoryHistory hook builds its query keys
  // off the real `budgetKeys.progress` shape, so the mock must keep it
  // (even though these tests never open the modal, the hook still runs).
  budgetKeys: {
    all: ["budgets"],
    progress: (year: number, month: number) => [
      "budgets",
      "progress",
      year,
      month,
    ],
  },
  useBudgetProgress: (...args: any[]) => mockUseBudgetProgress(...args),
  useBudgetSettings: (...args: any[]) => mockUseBudgetSettings(...args),
  useUpdateBudgetSettings: (...args: any[]) =>
    mockUseUpdateBudgetSettings(...args),
  useRecalculateBudgets: (...args: any[]) => mockUseRecalculateBudgets(...args),
  useClearBudgets: (...args: any[]) => mockUseClearBudgets(...args),
  useUpdateBudget: (...args: any[]) => mockUseUpdateBudget(...args),
  useCreateBudget: (...args: any[]) => mockUseCreateBudget(...args),
  useBudgetForecast: (...args: any[]) => mockUseBudgetForecast(...args),
  useUpdateBudgetForecast: (...args: any[]) =>
    mockUseUpdateBudgetForecast(...args),
  useMoveBudgetAmount: (...args: any[]) => mockUseMoveBudgetAmount(...args),
  ensureFlexBudget: () => mockEnsureFlexBudget(),
}));

vi.mock("@/hooks/use-settings", () => ({
  useCategories: (...args: any[]) => mockUseCategories(...args),
  useHousehold: () => ({ data: { household: { id: "house-1", currency: "ZMW" }, preferences: null } }),
  useDisplaySettings: () => ({
    data: { currency: "ZMW", numberFormat: "US" },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useGoals", () => ({
  useGoals: (...args: any[]) => mockUseGoals(...args),
}));

const budgetProgress = [
  {
    id: "flex-budget",
    householdId: "house-1",
    currency: "ZMW",
    name: "Flexible Budget",
    categoryId: null,
    categoryGroupId: null,
    amount: "500.00",
    period: "monthly",
    rolloverEnabled: false,
    isActive: true,
    isFlexBucket: true,
    createdAt: "",
    updatedAt: "",
    spent: 200,
    remaining: 300,
    percentUsed: 40,
  },
  {
    id: "budget-food",
    householdId: "house-1",
    currency: "ZMW",
    name: "Food",
    categoryId: "cat-food",
    categoryGroupId: null,
    amount: "150.00",
    period: "monthly",
    rolloverEnabled: false,
    isActive: true,
    isFlexBucket: false,
    createdAt: "",
    updatedAt: "",
    spent: 180,
    remaining: -30,
    percentUsed: 120,
  },
  {
    id: "budget-rent",
    householdId: "house-1",
    currency: "ZMW",
    name: "Rent",
    categoryId: "cat-rent",
    categoryGroupId: null,
    amount: "800.00",
    period: "monthly",
    rolloverEnabled: false,
    isActive: true,
    isFlexBucket: false,
    createdAt: "",
    updatedAt: "",
    spent: 800,
    remaining: 0,
    percentUsed: 100,
  },
];

const forecastData: BudgetForecastData = {
  range: [
    { year: 2025, month: 6 },
    { year: 2025, month: 7 },
  ],
  budgets: [
    {
      id: "budget-food",
      householdId: "house-1",
      name: "Food",
      categoryId: "cat-food",
      categoryGroupId: null,
      amount: { amount: "150.00", currency: "ZMW" },
      period: "monthly",
      rolloverEnabled: false,
      isActive: true,
      isFlexBucket: false,
      createdAt: "",
      updatedAt: "",
      periods: [
        { year: 2025, month: 6, amount: { amount: "150.00", currency: "ZMW" } },
        { year: 2025, month: 7, amount: { amount: "200.00", currency: "ZMW" } },
      ],
    },
  ],
};

const categoryGroups = [
  {
    id: "group-expenses",
    householdId: "house-1",
    name: "Expenses",
    type: "expense",
    budgetMode: "by_category",
    rolloverEnabled: false,
    isArchived: false,
    displayOrder: 1,
    createdAt: "",
    updatedAt: "",
  },
];

const categories = [
  {
    id: "cat-banking-fees",
    householdId: "house-1",
    groupId: "group-expenses",
    name: "Banking Fees",
    icon: null,
    color: null,
    includeInBudget: true,
    isArchived: false,
    displayOrder: 1,
    createdAt: "",
    updatedAt: "",
    budget: 1,
    spent: 3,
  },
];

describe("Budget page", () => {
  const renderBudget = async (seed?: (queryClient: QueryClient) => void) => {
    const Budget = (await import("@/pages/Budget")).default;
    const { SettingsProvider } = await import("@/contexts/SettingsContext");
    // BudgetDetailModal's useBudgetCategoryHistory hook calls the real
    // `useQueries` from @tanstack/react-query (it isn't mocked away like
    // the other budget hooks above), so it needs a real QueryClient in the
    // tree even though these tests never open the modal itself.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seed?.(queryClient);
    const tree = () => (
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <Budget />
        </SettingsProvider>
      </QueryClientProvider>
    );
    const view = render(tree());
    return { ...view, refreshBudget: () => view.rerender(tree()) };
  };

  const RealDate = Date;

  beforeEach(() => {
    const fixedDate = new RealDate("2025-06-15T12:00:00Z");
    vi.stubGlobal(
      "Date",
      class extends RealDate {
        constructor(...args: any[]) {
          super(...(args as [any]));
          if (args.length === 0) {
            // @ts-ignore
            return fixedDate;
          }
        }
        static now() {
          return fixedDate.valueOf();
        }
      }
    );

    mockUseBudgetProgress.mockReturnValue({
      data: budgetProgress,
      isLoading: false,
      error: null,
    });
    mockUseBudgetSettings.mockReturnValue({
      data: { budgetSystem: "flex", defaultApplyScope: "all_future" },
    });
    mockUseUpdateBudgetSettings.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    mockUseRecalculateBudgets.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    mockUseClearBudgets.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    mockUseUpdateBudget.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    mockUseCreateBudget.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    mockUseBudgetForecast.mockReturnValue({
      data: forecastData,
      isLoading: false,
    });
    mockUseUpdateBudgetForecast.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    mockUseMoveBudgetAmount.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    mockUseCategories.mockReturnValue({
      data: { categories, groups: categoryGroups },
      isLoading: false,
    });
    mockUseGoals.mockReturnValue({ data: [], isLoading: false });
  });

  afterEach(() => {
    retireOperationLifetime();
    vi.stubGlobal("Date", RealDate);
    vi.clearAllMocks();
  });

  // C3-10: a budget the server could not report is named with its reason,
  // never left looking unbudgeted.
  it("names a budget the server reported unavailable this month, with its reason", async () => {
    const { storeUnavailableBudgets } = await import("@/hooks/useUnavailableBudgets");
    await renderBudget(queryClient => storeUnavailableBudgets(queryClient, 2025, 6, { unavailableBudgets: [{
      id: "budget-travel", name: "Travel", categoryId: "cat-travel", categoryGroupId: null, currency: "USD",
      reason: { code: "BUDGET_CURRENCY_MISMATCH", message: "This budget's limit is in USD but the household reports in ZMW." } }] }));

    const notice = await screen.findByRole("status", { name: "Budgets not shown this month" });
    expect(notice).toHaveTextContent("1 budget is not shown this month");
    expect(notice).toHaveTextContent("Travel: This budget's limit is in USD but the household reports in ZMW.");
  });

  it("shows no unavailable-budget notice when every budget is reported", async () => {
    await renderBudget();
    await screen.findByRole("button", { name: /settings/i });
    expect(screen.queryByRole("status", { name: "Budgets not shown this month" })).not.toBeInTheDocument();
  });

  it("shows a withheld Flex limit from progress metadata without hiding exact reported spending", async () => {
    const { storeUnavailableBudgets } = await import("@/hooks/useUnavailableBudgets");
    const { storeUnbudgetedSpend } = await import("@/hooks/useUnbudgetedSpend");
    activateOperationLifetime(createOperationLifetime({ subject: "synthetic-owner", household: "house-1" }));
    const zmw = (amount: string) => ({ amount, currency: "ZMW" });
    const incomeGroup = { ...categoryGroups[0], id: "group-income", name: "Salary", type: "income", budgetMode: "by_group" };
    mockUseCategories.mockReturnValue({ data: { categories, groups: [...categoryGroups, incomeGroup] }, isLoading: false });
    mockUseBudgetProgress.mockReturnValue({ data: [
      { ...budgetProgress[1], id: "legacy-variable", categoryId: "cat-banking-fees",
        amount: zmw("150.00"), spent: zmw("40.00"), remaining: zmw("110.00") },
      { ...budgetProgress[1], id: "income", categoryId: null, categoryGroupId: incomeGroup.id,
        amount: zmw("500.00"), spent: zmw("460.00"), remaining: zmw("40.00") },
    ], isLoading: false, error: null });
    let clearWithheld!: () => void;
    await renderBudget(queryClient => {
      clearWithheld = () => storeUnavailableBudgets(queryClient, 2025, 6, {});
      storeUnavailableBudgets(queryClient, 2025, 6, { unavailableBudgets: [{
        id: "withheld-flex", name: "Flexible Budget", categoryId: null, categoryGroupId: null, currency: "USD",
        reason: { code: "BUDGET_CURRENCY_MISMATCH", message: "Flexible limit is in USD." },
      }] });
      storeUnbudgetedSpend(queryClient, 2025, 6, { unbudgetedSpent: { expense: zmw("2.50") } });
    });
    const flex = within((await screen.findByRole("button", { name: "Flexible budget group, expanded" })).parentElement!);
    const summaryHeader = within(screen.getByText("Left to budget").parentElement!);
    expect(flex.getByText("Unavailable")).toBeVisible();
    expect(flex.getByText("K40.00")).toBeVisible();
    expect(flex.queryByText("At least K40.00")).not.toBeInTheDocument();
    expect(flex.getByText("Incomplete")).toBeVisible();
    expect(flex.queryByRole("textbox")).not.toBeInTheDocument();
    expect(summaryHeader.getByText("Unavailable")).toBeVisible();
    expect(screen.getByText("K42.50 spent")).toBeVisible();
    expect(screen.queryByRole("progressbar", { name: /Expenses progress/ })).not.toBeInTheDocument();
    expect(mockEnsureFlexBudget).not.toHaveBeenCalled();
    for (const call of [...mockUseCreateBudget.mock.results, ...mockUseUpdateBudget.mock.results]) {
      expect(call.value.mutate).not.toHaveBeenCalled();
    }
    await act(clearWithheld);
    expect(await screen.findByRole("textbox", { name: "Budget amount for Flexible group" })).toHaveValue("150");
  });

  it("waits for confirmed Flex settings and disables the inline editor until the admitted write settles", async () => {
    activateOperationLifetime(createOperationLifetime({ subject: "synthetic-owner", household: "house-1" }));
    const money = (amount: string | number) => ({ amount: String(amount), currency: "ZMW" });
    mockUseBudgetProgress.mockReturnValue({ data: budgetProgress.map(row => ({ ...row,
      amount: money(row.amount), spent: money(row.spent), remaining: money(row.remaining) })), isLoading: false, error: null });
    mockUseBudgetSettings.mockReturnValue({ data: undefined, isLoading: true });
    let finish!: () => void;
    const write = new Promise<void>(resolve => { finish = resolve; });
    const update = vi.fn().mockReturnValue(write);
    mockUseUpdateBudget.mockReturnValue({ mutateAsync: update, mutate: vi.fn(), isPending: false });
    const view = await renderBudget();
    const inputName = { name: "Budget amount for Flexible group" };
    await screen.findByRole("button", { name: "Flexible budget group, expanded" });
    expect(screen.queryByRole("textbox", inputName)).not.toBeInTheDocument();

    mockUseBudgetSettings.mockReturnValue({ data: { budgetSystem: "category", defaultApplyScope: "all_future" } });
    view.refreshBudget();
    expect(screen.queryByRole("textbox", inputName)).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    expect(mockEnsureFlexBudget).not.toHaveBeenCalled();

    mockUseBudgetSettings.mockReturnValue({ data: { budgetSystem: "flex", defaultApplyScope: "all_future" } });
    view.refreshBudget();
    const input = await screen.findByRole("textbox", inputName);
    expect(input).toBeEnabled();
    expect(input).toHaveValue("500");
    fireEvent.change(input, { target: { value: "620.50" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: "flex-budget", data: { amount: money("620.50") } }));
    expect(input).toBeDisabled();
    expect(screen.getByText("Saving flexible budget…")).toBeVisible();
    await act(async () => { finish(); await write; });
    expect(input).toBeEnabled();
    expect(mockEnsureFlexBudget).not.toHaveBeenCalled();
  });

  it("saves budget settings selections", async () => {
    await renderBudget();

    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    await screen.findByText("Budget Settings");
    fireEvent.click(screen.getByText("Category Budget"));
    fireEvent.click(screen.getByText("This month only"));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    const updateSettings = mockUseUpdateBudgetSettings.mock.results[0].value;
    expect(updateSettings.mutate).toHaveBeenCalledWith(
      { budgetSystem: "category", defaultApplyScope: "this_month" },
      expect.anything()
    );
  });

  it("updates forecast amounts with apply scope", async () => {
    await renderBudget();

    fireEvent.click(screen.getByRole("button", { name: /forecast/i }));
    fireEvent.click(screen.getByRole("button", { name: "ZMW 150.00" }));
    await screen.findByText("Edit Forecast");

    const amountInput = screen.getByLabelText("Budget Amount");
    fireEvent.change(amountInput, { target: { value: "" } });
    fireEvent.change(amountInput, { target: { value: "180" } });
    fireEvent.click(screen.getByText("This and all future months"));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    const updateForecast = mockUseUpdateBudgetForecast.mock.results[0].value;
    expect(updateForecast.mutate).toHaveBeenCalledWith(
      {
        id: "budget-food",
        data: {
          year: 2025,
          month: 6,
          amount: { amount: "180", currency: "ZMW" },
          applyScope: "all_future",
          months: 12,
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });

  it("moves money between budgets with future scope", async () => {
    mockUseBudgetSettings.mockReturnValue({
      data: { budgetSystem: "category", defaultApplyScope: "all_future" },
    });
    mockUseBudgetProgress.mockReturnValue({ data: [...budgetProgress, {
      ...budgetProgress[1], id: "budget-banking-fees", name: "Banking Fees", categoryId: "cat-banking-fees",
      amount: { amount: "1.00", currency: "ZMW" }, spent: { amount: "3.00", currency: "ZMW" }, remaining: { amount: "-2.00", currency: "ZMW" },
    }], isLoading: false, error: null });
    await renderBudget();
    await screen.findByDisplayValue("Banking Fees");

    fireEvent.click(
      await screen.findByRole("button", { name: /move money for banking fees/i })
    );
    await screen.findByText("Move money");
    fireEvent.click(screen.getByLabelText("To"));
    fireEvent.click(screen.getByText("Rent"));

    const amountInput = screen.getByLabelText("Amount");
    fireEvent.change(amountInput, { target: { value: "" } });
    fireEvent.change(amountInput, { target: { value: "15" } });
    fireEvent.click(screen.getByText("All future months"));
    // The modal's submit button is labelled exactly "Move"; an anchored regex
    // avoids matching the row's "Move money for ..." trigger still in the DOM.
    fireEvent.click(screen.getByRole("button", { name: /^move$/i }));

    const moveBudget = mockUseMoveBudgetAmount.mock.results[0].value;
    expect(moveBudget.mutate).toHaveBeenCalledWith(
      {
        fromBudgetId: "budget-food",
        toBudgetId: "budget-rent",
        amount: { amount: "15", currency: "ZMW" },
        applyScope: "all_future",
        year: 2025,
        month: 6,
        months: 12,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
  });
});
