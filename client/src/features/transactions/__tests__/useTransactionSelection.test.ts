/**
 * useTransactionSelection Hook Tests
 *
 * Unit tests for the transaction selection state management hook.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useTransactionSelection } from "../hooks/useTransactionSelection";
import type { TransactionWithDetails } from "../types";

// Test data factory
const createMockTransaction = (id: string): TransactionWithDetails => ({
  id,
  householdId: "household-1",
  accountId: "account-1",
  date: "2024-01-15",
  name: `Transaction ${id}`,
  amount: { amount: "-50.00", currency: "ZMW" },
  type: "expense",
  isPending: false,
  isRecurring: false,
  isExcludedFromReports: false,
  isExcludedFromBudget: false,
  isPrivate: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const mockTransactions: TransactionWithDetails[] = [
  createMockTransaction("tx-1"),
  createMockTransaction("tx-2"),
  createMockTransaction("tx-3"),
  createMockTransaction("tx-4"),
  createMockTransaction("tx-5"),
];

describe("useTransactionSelection", () => {
  describe("Initial State", () => {
    it("should start with no selections", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      expect(result.current.selectedIds.size).toBe(0);
      expect(result.current.selectedCount).toBe(0);
      expect(result.current.hasSelection).toBe(false);
    });

    it("should not be all selected initially", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      expect(result.current.isAllSelected).toBe(false);
    });

    it("should have empty selectedTransactions array", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      expect(result.current.selectedTransactions).toEqual([]);
    });
  });

  describe("toggleSelection", () => {
    it("should add transaction to selection", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.toggleSelection("tx-1");
      });

      expect(result.current.selectedIds.has("tx-1")).toBe(true);
      expect(result.current.selectedCount).toBe(1);
    });

    it("should remove transaction from selection when toggled again", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.toggleSelection("tx-1");
      });

      act(() => {
        result.current.toggleSelection("tx-1");
      });

      expect(result.current.selectedIds.has("tx-1")).toBe(false);
      expect(result.current.selectedCount).toBe(0);
    });

    it("should handle multiple selections", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.toggleSelection("tx-1");
        result.current.toggleSelection("tx-3");
        result.current.toggleSelection("tx-5");
      });

      expect(result.current.selectedCount).toBe(3);
      expect(result.current.selectedIds.has("tx-1")).toBe(true);
      expect(result.current.selectedIds.has("tx-3")).toBe(true);
      expect(result.current.selectedIds.has("tx-5")).toBe(true);
      expect(result.current.selectedIds.has("tx-2")).toBe(false);
    });
  });

  describe("selectAll", () => {
    it("should select all transactions", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.selectAll();
      });

      expect(result.current.selectedCount).toBe(5);
      expect(result.current.isAllSelected).toBe(true);
    });

    it("should update selectedTransactions to include all", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.selectAll();
      });

      expect(result.current.selectedTransactions).toHaveLength(5);
    });
  });

  describe("clearSelection", () => {
    it("should clear all selections", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.selectAll();
      });

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedCount).toBe(0);
      expect(result.current.hasSelection).toBe(false);
    });
  });

  describe("selectRange", () => {
    it("should select transactions between two IDs", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.selectRange("tx-2", "tx-4");
      });

      expect(result.current.selectedCount).toBe(3);
      expect(result.current.selectedIds.has("tx-2")).toBe(true);
      expect(result.current.selectedIds.has("tx-3")).toBe(true);
      expect(result.current.selectedIds.has("tx-4")).toBe(true);
    });

    it("should work regardless of order", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.selectRange("tx-4", "tx-2");
      });

      expect(result.current.selectedCount).toBe(3);
    });

    it("should add to existing selection", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.toggleSelection("tx-1");
      });

      act(() => {
        result.current.selectRange("tx-3", "tx-5");
      });

      expect(result.current.selectedCount).toBe(4);
      expect(result.current.selectedIds.has("tx-1")).toBe(true);
    });

    it("should handle invalid IDs gracefully", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.selectRange("invalid-1", "invalid-2");
      });

      expect(result.current.selectedCount).toBe(0);
    });
  });

  describe("selectedTransactions", () => {
    it("should return the actual transaction objects", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.toggleSelection("tx-2");
      });

      const selected = result.current.selectedTransactions;
      expect(selected).toHaveLength(1);
      expect(selected[0].id).toBe("tx-2");
      expect(selected[0].name).toBe("Transaction tx-2");
    });
  });

  describe("isAllSelected", () => {
    it("should be false with partial selection", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.toggleSelection("tx-1");
        result.current.toggleSelection("tx-2");
      });

      expect(result.current.isAllSelected).toBe(false);
    });

    it("should be true when all are selected", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        mockTransactions.forEach((tx) => {
          result.current.toggleSelection(tx.id);
        });
      });

      expect(result.current.isAllSelected).toBe(true);
    });

    it("should be false with empty transactions", () => {
      const { result } = renderHook(() => useTransactionSelection([]));

      expect(result.current.isAllSelected).toBe(false);
    });
  });

  describe("hasSelection", () => {
    it("should be false with no selection", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      expect(result.current.hasSelection).toBe(false);
    });

    it("should be true with any selection", () => {
      const { result } = renderHook(() =>
        useTransactionSelection(mockTransactions)
      );

      act(() => {
        result.current.toggleSelection("tx-1");
      });

      expect(result.current.hasSelection).toBe(true);
    });
  });
});
