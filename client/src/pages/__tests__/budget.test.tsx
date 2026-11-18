import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
}));

vi.mock("@/hooks/use-settings", () => ({
  useCategories: (...args: any[]) => mockUseCategories(...args),
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

const forecastData = {
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
      amount: "150.00",
      period: "monthly",
      rolloverEnabled: false,
      isActive: true,
      isFlexBucket: false,
      createdAt: "",
      updatedAt: "",
      periods: [
        { year: 2025, month: 6, amount: "150.00" },
        { year: 2025, month: 7, amount: "200.00" },
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
  const renderBudget = async () => {
    const Budget = (await import("@/pages/Budget")).default;
    const { SettingsProvider } = await import("@/contexts/SettingsContext");
    // BudgetDetailModal's useBudgetCategoryHistory hook calls the real
    // `useQueries` from @tanstack/react-query (it isn't mocked away like
    // the other budget hooks above), so it needs a real QueryClient in the
    // tree even though these tests never open the modal itself.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <SettingsProvider>
          <Budget />
        </SettingsProvider>
      </QueryClientProvider>
    );
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
    vi.stubGlobal("Date", RealDate);
    vi.clearAllMocks();
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
    fireEvent.click(screen.getByRole("button", { name: /(?:K|\$)150/ }));
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
