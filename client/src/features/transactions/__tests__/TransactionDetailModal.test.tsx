import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TransactionDetailModal } from "../components/TransactionDetailModal";
import type { TransactionWithDetails } from "../types";

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    data: {
      categories: [
        { id: "cat-1", name: "Groceries", groupName: "Food" },
        { id: "cat-2", name: "Rent", groupName: "Housing" },
      ],
    },
  }),
}));

vi.mock("@/hooks/useTags", () => ({
  useTags: () => ({ data: [] }),
  useTransactionTags: () => ({ data: [] }),
  useAddTagsToTransaction: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveTagFromTransaction: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateTag: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useTransactions", () => ({
  useReviewTransaction: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateTransaction: () => ({ mutate: vi.fn(), isPending: false }),
}));

function renderAt(initialPath: string, transaction: TransactionWithDetails) {
  const { hook, searchHook, history } = memoryLocation({
    path: initialPath,
    record: true,
  });
  render(
    <Router hook={hook} searchHook={searchHook}>
      <TransactionDetailModal
        transaction={transaction}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onOpenRule={vi.fn()}
        onOpenRecurring={vi.fn()}
      />
    </Router>,
  );
  return { history: history! };
}

const baseTransaction: TransactionWithDetails = {
  id: "tx-1",
  householdId: "h-1",
  accountId: "acc-1",
  date: "2026-01-05",
  name: "Whole Foods",
  amount: { amount: "-42.50", currency: "USD" },
  type: "expense",
  categoryId: "cat-1",
  isPending: false,
  isRecurring: false,
  isExcludedFromReports: false,
  isExcludedFromBudget: false,
  isPrivate: false,
  createdAt: "2026-01-05T00:00:00Z",
  updatedAt: "2026-01-05T00:00:00Z",
  accountName: "Checking",
} as unknown as TransactionWithDetails;

describe("TransactionDetailModal deep links (audit v2 P2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates to the transactions list filtered by category when 'View transactions' is clicked", () => {
    const { history } = renderAt("/", baseTransaction);

    const viewTransactionsButton = screen.getByRole("button", {
      name: /view transactions/i,
    });
    fireEvent.click(viewTransactionsButton);

    const lastUrl = history[history.length - 1];
    expect(lastUrl.startsWith("/transactions?")).toBe(true);
    const params = new URLSearchParams(lastUrl.split("?")[1]);
    expect(params.get("categoryId")).toBe("cat-1");
  });

  it("falls back to the account filter when the transaction has no category", () => {
    const { history } = renderAt("/", {
      ...baseTransaction,
      categoryId: undefined,
    });

    const viewTransactionsButton = screen.getByRole("button", {
      name: /view transactions/i,
    });
    fireEvent.click(viewTransactionsButton);

    const lastUrl = history[history.length - 1];
    const params = new URLSearchParams(lastUrl.split("?")[1]);
    expect(params.get("accountId")).toBe("acc-1");
    expect(params.get("categoryId")).toBeNull();
  });

  it("links the account badge to the account detail page", () => {
    renderAt("/", baseTransaction);

    const accountLink = screen.getByRole("link", { name: /checking/i });
    expect(accountLink).toHaveAttribute("href", "/accounts/acc-1");
  });

  it("links to the recurring rule when the transaction is recurring", () => {
    renderAt("/", {
      ...baseTransaction,
      isRecurring: true,
      recurringTransactionId: "rec-9",
    });

    const recurringLink = screen.getByRole("link", {
      name: /view recurring rule/i,
    });
    expect(recurringLink).toHaveAttribute("href", "/recurring?ruleId=rec-9");
  });

  it("does not render a recurring rule link when the transaction is not recurring", () => {
    renderAt("/", baseTransaction);

    expect(
      screen.queryByRole("link", { name: /view recurring rule/i }),
    ).not.toBeInTheDocument();
  });
});
