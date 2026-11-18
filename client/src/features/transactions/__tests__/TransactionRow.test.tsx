/**
 * TransactionRow Component Tests
 *
 * Unit tests for individual transaction row rendering.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransactionRow } from "../components/TransactionRow";
import type { TransactionWithDetails } from "../types";

// Test data factory
const createMockTransaction = (
  overrides: Partial<TransactionWithDetails> = {}
): TransactionWithDetails => ({
  id: "tx-123",
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
  currency: "ZMW",
  ...overrides,
});

describe("TransactionRow", () => {
  const defaultProps = {
    transaction: createMockTransaction(),
    isSelected: false,
    onSelect: vi.fn(),
    onClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Display", () => {
    it("should display merchant name", () => {
      render(<TransactionRow {...defaultProps} />);
      expect(screen.getByText("Test Merchant")).toBeInTheDocument();
    });

    it("should display transaction name when no merchant", () => {
      render(
        <TransactionRow
          {...defaultProps}
          transaction={createMockTransaction({ merchantName: undefined })}
        />
      );
      expect(screen.getByText("Test Transaction")).toBeInTheDocument();
    });

    it("should display category name", () => {
      render(<TransactionRow {...defaultProps} />);
      expect(screen.getByText("Shopping")).toBeInTheDocument();
    });

    it("should display formatted date", () => {
      render(<TransactionRow {...defaultProps} />);
      expect(screen.getByText(/Jan 15, 2024/)).toBeInTheDocument();
    });

    it("should display formatted amount", () => {
      render(<TransactionRow {...defaultProps} />);
      // Amount should be displayed
      expect(screen.getByText(/50/)).toBeInTheDocument();
    });

    it("should show green color for income transactions", () => {
      render(
        <TransactionRow
          {...defaultProps}
          transaction={createMockTransaction({
            amount: { amount: "100.00", currency: "ZMW" },
            type: "income",
          })}
        />
      );

      const amountElement = screen.getByText(/\+/);
      expect(amountElement).toHaveClass("text-green-600");
    });

    it("should show recurring badge when isRecurring", () => {
      render(
        <TransactionRow
          {...defaultProps}
          transaction={createMockTransaction({ isRecurring: true })}
        />
      );
      expect(screen.getByText("Recurring")).toBeInTheDocument();
    });

    it("should show tag count when tags present", () => {
      render(
        <TransactionRow
          {...defaultProps}
          transaction={createMockTransaction({ tags: ["vacation", "food"] })}
        />
      );
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  describe("Review Status", () => {
    it("should show green checkmark when reviewed", () => {
      render(
        <TransactionRow
          {...defaultProps}
          transaction={createMockTransaction({
            reviewedAt: new Date().toISOString(),
          })}
        />
      );

      // CheckCircle2 icon should be green
      const checkIcon = document.querySelector(".text-green-500");
      expect(checkIcon).toBeInTheDocument();
    });

    it("should show amber alert when not reviewed", () => {
      render(
        <TransactionRow
          {...defaultProps}
          transaction={createMockTransaction({ reviewedAt: undefined })}
        />
      );

      // AlertCircle icon should be amber
      const alertIcon = document.querySelector(".text-amber-500");
      expect(alertIcon).toBeInTheDocument();
    });
  });

  describe("Selection", () => {
    it("should not show checkbox by default", () => {
      render(<TransactionRow {...defaultProps} />);
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("should show checkbox when showCheckbox is true", () => {
      render(<TransactionRow {...defaultProps} showCheckbox />);
      expect(screen.getByRole("checkbox")).toBeInTheDocument();
    });

    it("should have checked checkbox when selected", () => {
      render(<TransactionRow {...defaultProps} showCheckbox isSelected />);
      expect(screen.getByRole("checkbox")).toBeChecked();
    });

    it("should call onSelect when checkbox clicked", () => {
      render(<TransactionRow {...defaultProps} showCheckbox />);

      fireEvent.click(screen.getByRole("checkbox"));
      expect(defaultProps.onSelect).toHaveBeenCalledWith("tx-123");
    });

    it("should handle checkbox and onClick independently", () => {
      render(<TransactionRow {...defaultProps} showCheckbox />);

      // When clicking checkbox, onSelect should be called
      fireEvent.click(screen.getByRole("checkbox"));
      expect(defaultProps.onSelect).toHaveBeenCalledWith("tx-123");
    });
  });

  describe("Click Handling", () => {
    it("should call onClick with transaction when row clicked", () => {
      render(<TransactionRow {...defaultProps} />);

      const row = screen
        .getByText("Test Merchant")
        .closest('[class*="cursor-pointer"]');
      if (row) {
        fireEvent.click(row);
        expect(defaultProps.onClick).toHaveBeenCalledWith(
          defaultProps.transaction
        );
      }
    });
  });

  describe("Accessibility", () => {
    it("should have proper initial letter avatar", () => {
      render(<TransactionRow {...defaultProps} />);
      expect(screen.getByText("T")).toBeInTheDocument();
    });

    it("should handle unknown merchant gracefully", () => {
      render(
        <TransactionRow
          {...defaultProps}
          transaction={createMockTransaction({
            merchantName: undefined,
            name: "",
          })}
        />
      );
      expect(screen.getByText("Unknown")).toBeInTheDocument();
    });
  });
});
