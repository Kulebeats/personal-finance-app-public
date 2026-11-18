import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardTransactionsWidget from "../DashboardTransactionsWidget";

// Mock the hooks
const mockRefetch = vi.fn();
vi.mock("@/hooks/useTransactions", () => ({
  useTransactions: vi.fn(() => ({
    data: null,
    isLoading: true,
    error: null,
    refetch: mockRefetch,
  })),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    data: { categories: [] },
    isLoading: false,
  }),
}));

vi.mock("@/contexts/SettingsContext", () => ({
  useFormatters: () => ({
    formatCurrency: (val: number) => `$${val.toLocaleString()}`,
    formatDate: (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }),
}));

// Get the mocked hook for manipulation in tests
import { useTransactions } from "@/hooks/useTransactions";
const mockedUseTransactions = vi.mocked(useTransactions);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("DashboardTransactionsWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state", () => {
    mockedUseTransactions.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useTransactions>);

    render(<DashboardTransactionsWidget />, { wrapper: createWrapper() });

    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("renders error state with retry button", () => {
    mockedUseTransactions.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Failed to fetch"),
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useTransactions>);

    render(<DashboardTransactionsWidget />, { wrapper: createWrapper() });

    expect(screen.getByText("Unable to load transactions")).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch recent activity.")).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: /try again/i });
    fireEvent.click(retryButton);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("renders empty state when no transactions", () => {
    mockedUseTransactions.mockReturnValue({
      data: { transactions: [] },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useTransactions>);

    render(<DashboardTransactionsWidget />, { wrapper: createWrapper() });

    expect(screen.getByText("No recent transactions")).toBeInTheDocument();
  });

  it("renders transactions with correct type-based styling for income", () => {
    const mockTransactions = [
      {
        id: "1",
        name: "Salary",
        date: "2026-01-15",
        amount: { amount: "5000.00", currency: "USD" },
        type: "income" as const,
        categoryId: "cat1",
        categoryName: "Income",
        accountId: "acc1",
        householdId: "h1",
        isPending: false,
        isRecurring: false,
        isExcludedFromReports: false,
        isExcludedFromBudget: false,
        isPrivate: false,
        createdAt: "2026-01-15",
        updatedAt: "2026-01-15",
      },
    ];

    mockedUseTransactions.mockReturnValue({
      data: { transactions: mockTransactions },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useTransactions>);

    render(<DashboardTransactionsWidget />, { wrapper: createWrapper() });

    // Should display the transaction name
    expect(screen.getByText("Salary")).toBeInTheDocument();

    // Income should have emerald color styling
    const amountElement = screen.getByText("+$5,000");
    expect(amountElement).toHaveClass("text-emerald-600");
  });

  it("renders transactions with correct type-based styling for expense", () => {
    const mockTransactions = [
      {
        id: "2",
        name: "Groceries",
        date: "2026-01-15",
        amount: { amount: "150.00", currency: "USD" },
        type: "expense" as const,
        categoryId: "cat2",
        categoryName: "Food",
        accountId: "acc1",
        householdId: "h1",
        isPending: false,
        isRecurring: false,
        isExcludedFromReports: false,
        isExcludedFromBudget: false,
        isPrivate: false,
        createdAt: "2026-01-15",
        updatedAt: "2026-01-15",
      },
    ];

    mockedUseTransactions.mockReturnValue({
      data: { transactions: mockTransactions },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useTransactions>);

    render(<DashboardTransactionsWidget />, { wrapper: createWrapper() });

    expect(screen.getByText("Groceries")).toBeInTheDocument();

    // Expense should NOT have the + prefix and should have foreground color
    const amountElement = screen.getByText("$-150");
    expect(amountElement).toHaveClass("text-foreground");
  });

  it("handles MoneyDto amounts correctly via toMoneyNumber", () => {
    const mockTransactions = [
      {
        id: "3",
        name: "Test Transaction",
        date: "2026-01-15",
        amount: { amount: "1234.56", currency: "USD" },
        type: "expense" as const,
        categoryId: "cat1",
        categoryName: "Shopping",
        accountId: "acc1",
        householdId: "h1",
        isPending: false,
        isRecurring: false,
        isExcludedFromReports: false,
        isExcludedFromBudget: false,
        isPrivate: false,
        createdAt: "2026-01-15",
        updatedAt: "2026-01-15",
      },
    ];

    mockedUseTransactions.mockReturnValue({
      data: { transactions: mockTransactions },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useTransactions>);

    render(<DashboardTransactionsWidget />, { wrapper: createWrapper() });

    // Should correctly parse MoneyDto and display formatted amount
    // toMoneyNumber extracts "1234.56" from MoneyDto, then negates for expense
    expect(screen.getByText("$-1,234.56")).toBeInTheDocument();
  });

  it("opens transaction detail modal when clicking a transaction", () => {
    const mockTransactions = [
      {
        id: "4",
        name: "Coffee Shop",
        date: "2026-01-15",
        amount: { amount: "5.00", currency: "USD" },
        type: "expense" as const,
        categoryId: "cat1",
        categoryName: "Dining",
        accountId: "acc1",
        householdId: "h1",
        isPending: false,
        isRecurring: false,
        isExcludedFromReports: false,
        isExcludedFromBudget: false,
        isPrivate: false,
        createdAt: "2026-01-15",
        updatedAt: "2026-01-15",
      },
    ];

    mockedUseTransactions.mockReturnValue({
      data: { transactions: mockTransactions },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useTransactions>);

    render(<DashboardTransactionsWidget />, { wrapper: createWrapper() });

    // Click on the transaction row
    const transactionButton = screen.getByRole("button", { name: /view transaction coffee shop/i });
    fireEvent.click(transactionButton);

    // Modal should open (Dialog renders Transaction Details)
    expect(screen.getByText("Transaction Details")).toBeInTheDocument();
  });
});
