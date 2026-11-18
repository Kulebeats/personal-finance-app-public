/**
 * Filter Utils Tests
 *
 * Unit tests for transaction filtering utility functions.
 */

import { describe, it, expect } from "vitest";
import {
  matchesFilters,
  filterTransactions,
  getFilterSummary,
} from "../utils/filters";
import type { TransactionWithDetails, TransactionFilters } from "../types";
import { defaultFilters } from "../types";
import type { MoneyDto } from "@shared/money";

// Money amounts on Transaction are MoneyDto, not bare strings.
const money = (amount: string, currency = "USD"): MoneyDto => ({
  amount,
  currency,
});

// Test data factory
const createMockTransaction = (
  overrides: Partial<TransactionWithDetails> = {}
): TransactionWithDetails => ({
  id: `tx-${Math.random().toString(36).substr(2, 9)}`,
  householdId: "household-1",
  accountId: "account-1",
  date: "2024-01-15",
  name: "Test Transaction",
  amount: money("-50.00"),
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

describe("filters utils", () => {
  describe("matchesFilters", () => {
    describe("search filter", () => {
      it("should match when search is empty", () => {
        const tx = createMockTransaction();
        const filters: TransactionFilters = { ...defaultFilters, search: "" };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should match transaction name (case-insensitive)", () => {
        const tx = createMockTransaction({ name: "Coffee Purchase" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          search: "coffee",
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should match merchant name", () => {
        const tx = createMockTransaction({ merchantName: "Starbucks" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          search: "star",
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should match notes", () => {
        const tx = createMockTransaction({ notes: "Birthday gift" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          search: "birthday",
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should match category name", () => {
        const tx = createMockTransaction({ categoryName: "Entertainment" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          search: "entertain",
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should not match unrelated search", () => {
        const tx = createMockTransaction({ name: "Coffee" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          search: "groceries",
        };

        expect(matchesFilters(tx, filters)).toBe(false);
      });
    });

    describe("accountId filter", () => {
      it("should match when accountId is null", () => {
        const tx = createMockTransaction({ accountId: "acc-123" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          accountId: null,
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should match when accountId matches", () => {
        const tx = createMockTransaction({ accountId: "acc-123" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          accountId: "acc-123",
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should not match when accountId differs", () => {
        const tx = createMockTransaction({ accountId: "acc-123" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          accountId: "acc-456",
        };

        expect(matchesFilters(tx, filters)).toBe(false);
      });
    });

    describe("categoryId filter", () => {
      it("should match when categoryId is null", () => {
        const tx = createMockTransaction({ categoryId: "cat-123" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          categoryId: null,
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should match when categoryId matches", () => {
        const tx = createMockTransaction({ categoryId: "cat-123" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          categoryId: "cat-123",
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should not match when categoryId differs", () => {
        const tx = createMockTransaction({ categoryId: "cat-123" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          categoryId: "cat-456",
        };

        expect(matchesFilters(tx, filters)).toBe(false);
      });
    });

    describe("date range filter", () => {
      it("should match when no date range set", () => {
        const tx = createMockTransaction({ date: "2024-01-15" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          startDate: null,
          endDate: null,
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should match when transaction is within range", () => {
        const tx = createMockTransaction({ date: "2024-01-15" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          startDate: new Date("2024-01-01"),
          endDate: new Date("2024-01-31"),
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should not match when transaction is before start", () => {
        const tx = createMockTransaction({ date: "2023-12-15" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          startDate: new Date("2024-01-01"),
          endDate: null,
        };

        expect(matchesFilters(tx, filters)).toBe(false);
      });

      it("should not match when transaction is after end", () => {
        const tx = createMockTransaction({ date: "2024-02-15" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          startDate: null,
          endDate: new Date("2024-01-31"),
        };

        expect(matchesFilters(tx, filters)).toBe(false);
      });
    });

    describe("amount range filter", () => {
      it("should match when no amount range set", () => {
        const tx = createMockTransaction({ amount: money("-50.00") });
        const filters: TransactionFilters = {
          ...defaultFilters,
          amountMin: null,
          amountMax: null,
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should match when amount is within range", () => {
        const tx = createMockTransaction({ amount: money("-50.00") });
        const filters: TransactionFilters = {
          ...defaultFilters,
          amountMin: 10,
          amountMax: 100,
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should use absolute value for comparison", () => {
        const tx = createMockTransaction({ amount: money("-75.00") });
        const filters: TransactionFilters = {
          ...defaultFilters,
          amountMin: 50,
          amountMax: 100,
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should not match when amount is below min", () => {
        const tx = createMockTransaction({ amount: money("-5.00") });
        const filters: TransactionFilters = {
          ...defaultFilters,
          amountMin: 10,
          amountMax: null,
        };

        expect(matchesFilters(tx, filters)).toBe(false);
      });

      it("should not match when amount is above max", () => {
        const tx = createMockTransaction({ amount: money("-200.00") });
        const filters: TransactionFilters = {
          ...defaultFilters,
          amountMin: null,
          amountMax: 100,
        };

        expect(matchesFilters(tx, filters)).toBe(false);
      });
    });

    describe("type filter", () => {
      it("should match all types when filter is 'all'", () => {
        const expense = createMockTransaction({
          type: "expense",
          amount: money("-50.00"),
        });
        const income = createMockTransaction({
          type: "income",
          amount: money("100.00"),
        });
        const filters: TransactionFilters = { ...defaultFilters, type: "all" };

        expect(matchesFilters(expense, filters)).toBe(true);
        expect(matchesFilters(income, filters)).toBe(true);
      });

      it("should match only income when filter is 'income'", () => {
        const expense = createMockTransaction({
          type: "expense",
          amount: money("-50.00"),
        });
        const income = createMockTransaction({
          type: "income",
          amount: money("100.00"),
        });
        const filters: TransactionFilters = {
          ...defaultFilters,
          type: "income",
        };

        expect(matchesFilters(expense, filters)).toBe(false);
        expect(matchesFilters(income, filters)).toBe(true);
      });

      it("should match only expense when filter is 'expense'", () => {
        const expense = createMockTransaction({
          type: "expense",
          amount: money("-50.00"),
        });
        const income = createMockTransaction({
          type: "income",
          amount: money("100.00"),
        });
        const filters: TransactionFilters = {
          ...defaultFilters,
          type: "expense",
        };

        expect(matchesFilters(expense, filters)).toBe(true);
        expect(matchesFilters(income, filters)).toBe(false);
      });

      it("should match only transfer when filter is 'transfer'", () => {
        const expense = createMockTransaction({ type: "expense" });
        const transfer = createMockTransaction({ type: "transfer" });
        const filters: TransactionFilters = {
          ...defaultFilters,
          type: "transfer",
        };

        expect(matchesFilters(expense, filters)).toBe(false);
        expect(matchesFilters(transfer, filters)).toBe(true);
      });
    });

    describe("reviewed filter", () => {
      it("should match all when filter is 'all'", () => {
        const reviewed = createMockTransaction({
          reviewedAt: new Date().toISOString(),
        });
        const unreviewed = createMockTransaction({ reviewedAt: undefined });
        const filters: TransactionFilters = {
          ...defaultFilters,
          reviewed: "all",
        };

        expect(matchesFilters(reviewed, filters)).toBe(true);
        expect(matchesFilters(unreviewed, filters)).toBe(true);
      });

      it("should match only reviewed when filter is 'reviewed'", () => {
        const reviewed = createMockTransaction({
          reviewedAt: new Date().toISOString(),
        });
        const unreviewed = createMockTransaction({ reviewedAt: undefined });
        const filters: TransactionFilters = {
          ...defaultFilters,
          reviewed: "reviewed",
        };

        expect(matchesFilters(reviewed, filters)).toBe(true);
        expect(matchesFilters(unreviewed, filters)).toBe(false);
      });

      it("should match only unreviewed when filter is 'unreviewed'", () => {
        const reviewed = createMockTransaction({
          reviewedAt: new Date().toISOString(),
        });
        const unreviewed = createMockTransaction({ reviewedAt: undefined });
        const filters: TransactionFilters = {
          ...defaultFilters,
          reviewed: "unreviewed",
        };

        expect(matchesFilters(reviewed, filters)).toBe(false);
        expect(matchesFilters(unreviewed, filters)).toBe(true);
      });
    });

    describe("combined filters", () => {
      it("should match transaction meeting all criteria", () => {
        const tx = createMockTransaction({
          name: "Coffee",
          accountId: "acc-123",
          type: "expense",
          amount: money("-5.00"),
        });

        const filters: TransactionFilters = {
          ...defaultFilters,
          search: "coffee",
          accountId: "acc-123",
          type: "expense",
          amountMin: 1,
          amountMax: 10,
        };

        expect(matchesFilters(tx, filters)).toBe(true);
      });

      it("should not match if any filter fails", () => {
        const tx = createMockTransaction({
          name: "Coffee",
          accountId: "acc-123",
          type: "expense",
        });

        const filters: TransactionFilters = {
          ...defaultFilters,
          search: "coffee",
          accountId: "acc-456", // Different account
        };

        expect(matchesFilters(tx, filters)).toBe(false);
      });
    });
  });

  describe("filterTransactions", () => {
    it("should return all transactions when no filters", () => {
      const transactions = [
        createMockTransaction({ id: "1" }),
        createMockTransaction({ id: "2" }),
        createMockTransaction({ id: "3" }),
      ];

      const result = filterTransactions(transactions, defaultFilters);
      expect(result).toHaveLength(3);
    });

    it("should return filtered transactions", () => {
      const transactions = [
        createMockTransaction({ id: "1", name: "Coffee" }),
        createMockTransaction({ id: "2", name: "Groceries" }),
        createMockTransaction({ id: "3", name: "Coffee Shop" }),
      ];

      const filters: TransactionFilters = {
        ...defaultFilters,
        search: "coffee",
      };
      const result = filterTransactions(transactions, filters);

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id)).toEqual(["1", "3"]);
    });

    it("should return empty array when no matches", () => {
      const transactions = [
        createMockTransaction({ id: "1", name: "Coffee" }),
        createMockTransaction({ id: "2", name: "Groceries" }),
      ];

      const filters: TransactionFilters = {
        ...defaultFilters,
        search: "restaurant",
      };
      const result = filterTransactions(transactions, filters);

      expect(result).toHaveLength(0);
    });
  });

  describe("getFilterSummary", () => {
    it("should return 'All transactions' for default filters", () => {
      expect(getFilterSummary(defaultFilters)).toBe("All transactions");
    });

    it("should include Account when accountId set", () => {
      const filters: TransactionFilters = {
        ...defaultFilters,
        accountId: "acc-123",
      };
      expect(getFilterSummary(filters)).toContain("Account");
    });

    it("should include Category when categoryId set", () => {
      const filters: TransactionFilters = {
        ...defaultFilters,
        categoryId: "cat-123",
      };
      expect(getFilterSummary(filters)).toContain("Category");
    });

    it("should include Date range when dates set", () => {
      const filters: TransactionFilters = {
        ...defaultFilters,
        startDate: new Date(),
      };
      expect(getFilterSummary(filters)).toContain("Date range");
    });

    it("should include Amount when amount range set", () => {
      const filters: TransactionFilters = { ...defaultFilters, amountMin: 10 };
      expect(getFilterSummary(filters)).toContain("Amount");
    });

    it("should include type when not 'all'", () => {
      const filters: TransactionFilters = {
        ...defaultFilters,
        type: "expense",
      };
      expect(getFilterSummary(filters)).toContain("expense");
    });

    it("should include multiple filters", () => {
      const filters: TransactionFilters = {
        ...defaultFilters,
        accountId: "acc-123",
        type: "expense",
        reviewed: "unreviewed",
      };
      const summary = getFilterSummary(filters);

      expect(summary).toContain("Account");
      expect(summary).toContain("expense");
      expect(summary).toContain("unreviewed");
    });
  });
});
