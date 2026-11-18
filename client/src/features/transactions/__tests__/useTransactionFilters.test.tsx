/**
 * useTransactionFilters Hook Tests
 *
 * Unit tests for the URL-backed transaction filters hook (R8). The URL is
 * the single source of truth, so every test mounts the hook inside a wouter
 * `<Router>` seeded with an isolated in-memory location - this avoids tests
 * bleeding query-string state into each other via the real `window.location`.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactNode } from "react";
import { useTransactionFilters } from "../hooks/useTransactionFilters";
import { defaultFilters } from "../types";

function createWrapper(initialPath = "/transactions") {
  const { hook, searchHook, history } = memoryLocation({
    path: initialPath,
    record: true,
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Router hook={hook} searchHook={searchHook}>
      {children}
    </Router>
  );
  return { Wrapper, history: history! };
}

describe("useTransactionFilters", () => {
  describe("Initial State", () => {
    it("should initialize with default filters when the URL has no params", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      expect(result.current.filters).toEqual(defaultFilters);
    });

    it("should hydrate filters from the URL query string on mount", () => {
      const { Wrapper } = createWrapper(
        "/transactions?q=coffee&type=expense",
      );
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      expect(result.current.filters.search).toBe("coffee");
      expect(result.current.filters.type).toBe("expense");
    });

    it("should fall back to defaults for filters absent from the URL", () => {
      const { Wrapper } = createWrapper("/transactions?q=test");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      expect(result.current.filters.search).toBe("test");
      expect(result.current.filters.accountId).toBe(defaultFilters.accountId);
    });
  });

  describe("setFilters", () => {
    it("should update a single filter and write it to the URL (replace)", () => {
      const { Wrapper, history } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({ search: "grocery" });
      });

      expect(result.current.filters.search).toBe("grocery");
      expect(history[history.length - 1]).toBe("/transactions?q=grocery");
      // replace, not push - a filter tweak shouldn't grow browser history
      expect(history.length).toBe(1);
    });

    it("should update multiple filters at once", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({
          search: "test",
          type: "income",
          reviewed: "reviewed",
        });
      });

      expect(result.current.filters.search).toBe("test");
      expect(result.current.filters.type).toBe("income");
      expect(result.current.filters.reviewed).toBe("reviewed");
    });

    it("should preserve other filters when updating", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({ search: "first" });
      });

      act(() => {
        result.current.setFilters({ type: "expense" });
      });

      expect(result.current.filters.search).toBe("first");
      expect(result.current.filters.type).toBe("expense");
    });
  });

  describe("resetFilters", () => {
    it("should reset all filters to defaults and clear the URL", () => {
      const { Wrapper, history } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({
          search: "test",
          type: "income",
          accountId: "acc-123",
        });
      });

      act(() => {
        result.current.resetFilters();
      });

      expect(result.current.filters).toEqual(defaultFilters);
      expect(history[history.length - 1]).toBe("/transactions");
    });
  });

  describe("hasActiveFilters", () => {
    it("should be false when using default filters", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      expect(result.current.hasActiveFilters).toBe(false);
    });

    it("should be true when search is set", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({ search: "test" });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it("should be true when accountId is set", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({ accountId: "acc-123" });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it("should be true when type is not 'all'", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({ type: "expense" });
      });

      expect(result.current.hasActiveFilters).toBe(true);
    });

    it("should be false after reset", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({ search: "test" });
      });

      act(() => {
        result.current.resetFilters();
      });

      expect(result.current.hasActiveFilters).toBe(false);
    });

    it("should be true when hydrated from a URL that already carries filters", () => {
      const { Wrapper } = createWrapper("/transactions?categoryId=cat-1");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      expect(result.current.hasActiveFilters).toBe(true);
      expect(result.current.filters.categoryId).toBe("cat-1");
    });
  });

  describe("activeFilterCount", () => {
    it("should be 0 with default filters", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      expect(result.current.activeFilterCount).toBe(0);
    });

    it("should not count search in activeFilterCount", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({ search: "test" });
      });

      expect(result.current.activeFilterCount).toBe(0);
    });

    it("should count accountId filter", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({ accountId: "acc-123" });
      });

      expect(result.current.activeFilterCount).toBe(1);
    });

    it("should count categoryId filter", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({ categoryId: "cat-456" });
      });

      expect(result.current.activeFilterCount).toBe(1);
    });

    it("should count date range as one filter", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({
          startDate: new Date(2024, 0, 1),
          endDate: new Date(2024, 0, 31),
        });
      });

      expect(result.current.activeFilterCount).toBe(1);
    });

    it("should count amount range as one filter", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({
          amountMin: 10,
          amountMax: 100,
        });
      });

      expect(result.current.activeFilterCount).toBe(1);
    });

    it("should count multiple filters correctly", () => {
      const { Wrapper } = createWrapper("/transactions");
      const { result } = renderHook(() => useTransactionFilters(), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.setFilters({
          accountId: "acc-123",
          categoryId: "cat-456",
          type: "expense",
          reviewed: "unreviewed",
        });
      });

      expect(result.current.activeFilterCount).toBe(4);
    });
  });
});
