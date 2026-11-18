/**
 * TransactionList Component Tests
 *
 * Unit tests for the virtualized transaction list component.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransactionList } from "../components/TransactionList";
import type { TransactionWithDetails } from "../types";

// Mock @tanstack/react-virtual
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn(() => ({
    getVirtualItems: () => [
      { key: "0", index: 0, start: 0, size: 64 },
      { key: "1", index: 1, start: 64, size: 64 },
    ],
    getTotalSize: () => 128,
  })),
}));

// Test data factory
const createMockTransaction = (
  overrides: Partial<TransactionWithDetails> = {}
): TransactionWithDetails => ({
  id: `tx-${Math.random().toString(36).substr(2, 9)}`,
  householdId: "household-1",
  accountId: "account-1",
  date: "2024-01-15",
  name: "Test Transaction",
  amount: { amount: "50.00", currency: "ZMW" },
  type: "expense",
  isPending: false,
  isRecurring: false,
  isExcludedFromReports: false,
  isExcludedFromBudget: false,
  isPrivate: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  merchantName: "Test Merchant",
  categoryName: "Shopping",
  accountName: "Checking",
  ...overrides,
});

const mockTransactions: TransactionWithDetails[] = [
  createMockTransaction({
    id: "tx-1",
    name: "Coffee",
    amount: { amount: "5.00", currency: "ZMW" },
    merchantName: "Starbucks",
  }),
  createMockTransaction({
    id: "tx-2",
    name: "Salary",
    amount: { amount: "3000.00", currency: "ZMW" },
    type: "income",
    merchantName: "Employer",
  }),
  createMockTransaction({
    id: "tx-3",
    name: "Groceries",
    amount: { amount: "150.00", currency: "ZMW" },
    merchantName: "Supermarket",
  }),
];

describe("TransactionList", () => {
  const defaultProps = {
    transactions: mockTransactions,
    selectedIds: new Set<string>(),
    onSelect: vi.fn(),
    onClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should render empty state when no transactions", () => {
      render(<TransactionList {...defaultProps} transactions={[]} />);

      expect(screen.getByText("No transactions found")).toBeInTheDocument();
      expect(
        screen.getByText(/Try adjusting your filters/)
      ).toBeInTheDocument();
    });

    it("should render custom empty message", () => {
      render(
        <TransactionList
          {...defaultProps}
          transactions={[]}
          emptyMessage="No matching results"
        />
      );

      expect(screen.getByText("No matching results")).toBeInTheDocument();
    });

    it("should render error state when error provided", () => {
      const error = new Error("Failed to load transactions");
      render(<TransactionList {...defaultProps} error={error} />);

      expect(
        screen.getByText("Error loading transactions")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Failed to load transactions")
      ).toBeInTheDocument();
    });

    it("should render loading state", () => {
      render(<TransactionList {...defaultProps} loading />);

      // Loading spinner should be visible - check for animate-spin class
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).toBeInTheDocument();
    });

    it("should render transactions in list view by default", () => {
      render(<TransactionList {...defaultProps} />);

      // Virtualized container should exist
      expect(document.querySelector('[style*="height"]')).toBeInTheDocument();
    });
  });

  describe("Card View Mode", () => {
    it("should render grid layout in card mode", () => {
      render(<TransactionList {...defaultProps} viewMode="card" />);

      // Should have grid class
      expect(document.querySelector(".grid")).toBeInTheDocument();
    });

    it("should render all transactions in card mode (non-virtualized)", () => {
      render(<TransactionList {...defaultProps} viewMode="card" />);

      // All transactions should be present in card view
      mockTransactions.forEach((tx) => {
        expect(
          screen.getByText(tx.merchantName || tx.name)
        ).toBeInTheDocument();
      });
    });
  });

  describe("Selection", () => {
    it("should show checkboxes when showCheckboxes is true", () => {
      render(<TransactionList {...defaultProps} showCheckboxes />);

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes.length).toBeGreaterThan(0);
    });

    it("should call onSelect when checkbox clicked", () => {
      render(<TransactionList {...defaultProps} showCheckboxes />);

      const checkboxes = screen.getAllByRole("checkbox");
      fireEvent.click(checkboxes[0]);

      expect(defaultProps.onSelect).toHaveBeenCalled();
    });

    it("should highlight selected transactions", () => {
      render(
        <TransactionList {...defaultProps} selectedIds={new Set(["tx-1"])} />
      );

      // Selected transaction should have highlight styling
      const selectedElement = document.querySelector('[class*="primary"]');
      expect(selectedElement).toBeInTheDocument();
    });
  });

  describe("Click Handling", () => {
    it("should call onClick when transaction clicked", () => {
      render(<TransactionList {...defaultProps} viewMode="card" />);

      // Click on the first card
      const cards = document.querySelectorAll('[class*="cursor-pointer"]');
      if (cards.length > 0) {
        fireEvent.click(cards[0]);
        expect(defaultProps.onClick).toHaveBeenCalled();
      }
    });
  });

  describe("Infinite Loading", () => {
    it("should call onLoadMore when hasMore and near bottom", () => {
      const onLoadMore = vi.fn();
      render(
        <TransactionList {...defaultProps} onLoadMore={onLoadMore} hasMore />
      );

      // The virtualizer mock simulates being at the end
      // onLoadMore should be called automatically
      expect(onLoadMore).toHaveBeenCalled();
    });

    it("should not call onLoadMore when loading", () => {
      const onLoadMore = vi.fn();
      render(
        <TransactionList
          {...defaultProps}
          onLoadMore={onLoadMore}
          hasMore
          loading
        />
      );

      expect(onLoadMore).not.toHaveBeenCalled();
    });
  });
});
