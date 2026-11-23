/**
 * Transactions Page URL Filter Contract Tests (R8)
 *
 * Verifies the keystone behavior audit v2 finding B1 was about: mounting the
 * Transactions page with filter query params must actually apply those
 * filters to the transaction query, and changing a filter in the UI must
 * write the change back to the URL (replace, not push).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import React from "react";

const useInfiniteTransactionsMock = vi.fn((..._args: unknown[]) => ({
  data: { pages: [{ transactions: [] }] },
  fetchNextPage: vi.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
  isLoading: false,
  isError: false,
  error: null,
}));

vi.mock("@/hooks/useTransactions", async importOriginal => ({
  useTransactionSummary: (await importOriginal<typeof import("@/hooks/useTransactions")>()).useTransactionSummary,
  useInfiniteTransactions: (...args: unknown[]) => useInfiniteTransactionsMock(...args),
  useUpdateTransaction: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useReviewTransaction: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateTransaction: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: vi.fn(() => ({
    data: { categories: [{ id: "cat-1", name: "Food & Drink", groupName: "Expenses" }] },
  })),
  findCategoryByName: vi.fn(),
}));

vi.mock("@/hooks/useTags", () => ({
  useTags: vi.fn(() => ({ data: [] })),
  useTransactionTags: vi.fn(() => ({ data: [] })),
  useAddTagsToTransaction: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRemoveTagFromTransaction: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useCreateTag: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("@/hooks/use-settings", () => ({
  useProfile: vi.fn(() => ({ data: { id: "user-1", name: "Test User" } })),
  useMerchantTransactions: vi.fn(() => ({})),
}));

vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: vi.fn(() => ({
    data: [{ id: "acc-1", name: "Checking", balance: "1000.00" }],
  })),
}));

vi.mock("@/components/import/ImportWizardContext", () => ({
  useImportWizard: vi.fn(() => ({ openWizard: vi.fn() })),
}));

vi.mock("@/lib/api", () => ({
  transactionsApi: {
    getSummary: vi.fn(() =>
      Promise.resolve({
        totalIncome: { amount: "0.00", currency: "ZMW" },
        totalExpenses: { amount: "0.00", currency: "ZMW" },
        netFlow: { amount: "0.00", currency: "ZMW" },
        transactionCount: 0,
      }),
    ),
  },
}));

vi.mock("@/components/Layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

vi.mock("@/components/transactions/AddTransactionModal", () => ({
  AddTransactionModal: () => null,
}));

vi.mock("@/components/transactions/DateRangePopover", () => ({
  DateRangePopover: () => <button>Date</button>,
}));

vi.mock("@/components/transactions/TransactionSummaryPanel", () => ({
  TransactionSummaryPanel: () => <div data-testid="summary-panel" />,
}));

// Import after mocks
import Transactions from "@/pages/Transactions";

function renderTransactionsAt(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook, searchHook, history } = memoryLocation({ path: initialPath, record: true });

  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook} searchHook={searchHook}>
        <Transactions />
      </Router>
    </QueryClientProvider>,
  );

  return { history: history! };
}

describe("Transactions page URL filter contract (R8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies filters parsed from the URL to the transactions query on mount", () => {
    renderTransactionsAt("/transactions?categoryId=cat-1&type=expense&q=coffee");

    expect(useInfiniteTransactionsMock).toHaveBeenCalled();
    const lastCallArgs = useInfiniteTransactionsMock.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;

    expect(lastCallArgs?.categoryId).toBe("cat-1");
    expect(lastCallArgs?.type).toBe("expense");
    expect(lastCallArgs?.search).toBe("coffee");
  });

  it("renders an unfiltered view identically to today when the URL has no params", () => {
    renderTransactionsAt("/transactions");

    const lastCallArgs = useInfiniteTransactionsMock.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;

    expect(lastCallArgs?.categoryId).toBeUndefined();
    expect(lastCallArgs?.type).toBeUndefined();
    expect(lastCallArgs?.search).toBeUndefined();
  });

  it("writes a changed filter back to the URL via replace (not push)", async () => {
    const { history } = renderTransactionsAt("/transactions");

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "latte" } });

    await waitFor(() => {
      expect(history[history.length - 1]).toBe("/transactions?q=latte");
    });

    // The debounced search commit replaced the initial entry rather than
    // pushing a new one - filter tweaks must not grow browser history.
    expect(history.length).toBe(1);
  });

  it("keeps a query param the filter contract does not own (?action=add) out of the way of filtering", () => {
    renderTransactionsAt("/transactions?accountId=acc-1&action=add");

    const lastCallArgs = useInfiniteTransactionsMock.mock.calls.at(-1)?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(lastCallArgs?.accountId).toBe("acc-1");
  });
});
