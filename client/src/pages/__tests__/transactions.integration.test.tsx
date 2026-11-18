/**
 * Transactions Page Integration Tests
 *
 * Integration tests for the Transactions page component.
 * Tests that the page renders correctly and basic interactions work.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// Mock the hooks and APIs
vi.mock("@/hooks/useTransactions", () => ({
  useInfiniteTransactions: vi.fn(() => ({
    data: {
      pages: [
        {
          transactions: [
            {
              id: "tx-1",
              name: "Coffee",
              amount: { amount: "5.00", currency: "ZMW" },
              date: "2024-01-15",
              type: "expense",
              merchantName: "Starbucks",
              categoryName: "Food & Drink",
              accountName: "Checking",
              isPending: false,
              isRecurring: false,
              isExcludedFromReports: false,
              isExcludedFromBudget: false,
              isPrivate: false,
            },
            {
              id: "tx-2",
              name: "Salary",
              amount: { amount: "3000.00", currency: "ZMW" },
              date: "2024-01-14",
              type: "income",
              merchantName: "Employer Inc",
              categoryName: "Income",
              accountName: "Checking",
              isPending: false,
              isRecurring: true,
              isExcludedFromReports: false,
              isExcludedFromBudget: false,
              isPrivate: false,
            },
            {
              id: "tx-3",
              name: "Groceries",
              amount: { amount: "150.00", currency: "ZMW" },
              date: "2024-01-13",
              type: "expense",
              merchantName: "Supermarket",
              categoryName: "Groceries",
              accountName: "Checking",
              isPending: false,
              isRecurring: false,
              isExcludedFromReports: false,
              isExcludedFromBudget: false,
              isPrivate: false,
              reviewedAt: new Date().toISOString(),
            },
          ],
        },
      ],
    },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
  })),
  useUpdateTransaction: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useReviewTransaction: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useCreateTransaction: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: vi.fn(() => ({
    data: {
      categories: [
        { id: "cat-1", name: "Food & Drink", groupName: "Expenses" },
        { id: "cat-2", name: "Groceries", groupName: "Expenses" },
        { id: "cat-3", name: "Income", groupName: "Income" },
      ],
    },
  })),
  findCategoryByName: vi.fn(),
}));

vi.mock("@/hooks/useTags", () => ({
  useTags: vi.fn(() => ({
    data: [{ name: "vacation" }, { name: "business" }],
  })),
  useTransactionTags: vi.fn(() => ({
    data: [],
  })),
  useAddTagsToTransaction: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useRemoveTagFromTransaction: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useCreateTag: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

vi.mock("@/hooks/use-settings", () => ({
  useProfile: vi.fn(() => ({
    data: { id: "user-1", name: "Test User" },
  })),
  useMerchantTransactions: vi.fn(() => ({})),
}));

vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: vi.fn(() => ({
    data: [
      { id: "acc-1", name: "Checking", balance: "1000.00" },
      { id: "acc-2", name: "Savings", balance: "5000.00" },
    ],
  })),
}));

vi.mock("@/components/import/ImportWizardContext", () => ({
  useImportWizard: vi.fn(() => ({
    openWizard: vi.fn(),
  })),
}));

vi.mock("@/lib/api", () => ({
  transactionsApi: {
    getSummary: vi.fn(() =>
      Promise.resolve({
        totalIncome: { amount: "3000.00", currency: "ZMW" },
        totalExpenses: { amount: "155.00", currency: "ZMW" },
        netFlow: { amount: "2845.00", currency: "ZMW" },
        transactionCount: 3,
      }),
    ),
  },
}));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

vi.mock("@/components/transactions/AddTransactionModal", () => ({
  AddTransactionModal: () => null,
}));

vi.mock("@/components/transactions/DateRangePopover", () => ({
  DateRangePopover: () => <button>Date</button>,
}));

vi.mock("@/components/transactions/TransactionSummaryPanel", () => ({
  TransactionSummaryPanel: ({ income, expenses, transactionCount }: any) => (
    <div data-testid="summary-panel">
      <span>Income: {income}</span>
      <span>Expenses: {expenses}</span>
      <span>Count: {transactionCount}</span>
    </div>
  ),
}));

// Import after mocks
import Transactions from "@/pages/Transactions";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
};

describe("Transactions Page Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Page Layout", () => {
    it("should render within layout component", () => {
      render(<Transactions />, { wrapper: createWrapper() });
      expect(screen.getByTestId("layout")).toBeInTheDocument();
    });

    it("should render page title", () => {
      render(<Transactions />, { wrapper: createWrapper() });
      expect(screen.getByText("Transactions")).toBeInTheDocument();
    });
  });

  describe("Header Actions", () => {
    it("should render Import button", () => {
      render(<Transactions />, { wrapper: createWrapper() });
      expect(screen.getByText("Import")).toBeInTheDocument();
    });

    it("should render Add Transaction button", () => {
      render(<Transactions />, { wrapper: createWrapper() });
      expect(screen.getByText("Add Transaction")).toBeInTheDocument();
    });
  });

  describe("Summary Panel", () => {
    it("should show transaction summary panel", () => {
      render(<Transactions />, { wrapper: createWrapper() });
      expect(screen.getByTestId("summary-panel")).toBeInTheDocument();
    });

    it("should calculate income from transactions", async () => {
      render(<Transactions />, { wrapper: createWrapper() });
      await waitFor(() => {
        expect(screen.getByText("Income: 3000")).toBeInTheDocument();
      });
    });

    it("should calculate expenses from transactions", async () => {
      render(<Transactions />, { wrapper: createWrapper() });
      await waitFor(() => {
        expect(screen.getByText("Expenses: 155")).toBeInTheDocument();
      });
    });

    it("should show transaction count", async () => {
      render(<Transactions />, { wrapper: createWrapper() });
      await waitFor(() => {
        expect(screen.getByText("Count: 3")).toBeInTheDocument();
      });
    });
  });

  describe("Search and Filters", () => {
    it("should render search input", () => {
      render(<Transactions />, { wrapper: createWrapper() });
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
    });

    it("should update search value on input", () => {
      render(<Transactions />, { wrapper: createWrapper() });

      const searchInput = screen.getByPlaceholderText(/search/i);
      fireEvent.change(searchInput, { target: { value: "coffee" } });

      expect(searchInput).toHaveValue("coffee");
    });

    it("should render Filters button", () => {
      render(<Transactions />, { wrapper: createWrapper() });
      expect(screen.getByText("Filters")).toBeInTheDocument();
    });

    it("should render Date button", () => {
      render(<Transactions />, { wrapper: createWrapper() });
      expect(screen.getByText("Date")).toBeInTheDocument();
    });
  });
});
