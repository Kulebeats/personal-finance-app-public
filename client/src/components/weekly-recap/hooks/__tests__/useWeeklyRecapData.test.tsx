/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import {
  useWeeklyRecapData,
  useWeeklyRecapFeedback,
  type WeeklyRecapData,
} from "../useWeeklyRecapData";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

// The feedback mutation goes through apiCall, which fetches a CSRF token
// (GET /api/csrf-token) before each mutating request. Serve that token
// transparently so it never consumes per-test mocks; everything else is
// forwarded to mockFetch.
const mockFetch = vi.fn();

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
};

const mockFetchResponse = (data: unknown, ok = true): Response =>
  ({
    ok,
    json: vi.fn().mockResolvedValue(data),
  }) as unknown as Response;

describe("useWeeklyRecapData hooks", () => {
  const mockRecapData: WeeklyRecapData = {
    weekStart: "2026-01-20",
    weekEnd: "2026-01-26",
    netWorth: {
      current: 50000,
      previous: 48000,
      change: 2000,
      changePercent: 4.17,
      series: [
        { date: "2026-01-20", value: 48000 },
        { date: "2026-01-26", value: 50000 },
      ],
      trend: "up",
    },
    spending: {
      total: 1500,
      topCategories: [
        { categoryId: "cat-1", name: "Food", amount: 500, percent: 33.3 },
        { categoryId: "cat-2", name: "Transport", amount: 300, percent: 20 },
      ],
      hasData: true,
      changePercent: -5,
      trend: [
        { date: "2026-01-20", amount: 200 },
        { date: "2026-01-21", amount: 250 },
      ],
    },
    recurring: {
      upcoming: [
        { id: "rec-1", name: "Netflix", amount: 15.99, dueDate: "2026-01-28", frequency: "monthly" },
        { id: "rec-2", name: "Spotify", amount: 9.99, dueDate: "2026-01-30", frequency: "monthly" },
      ],
      count: 2,
      totalAmount: 25.98,
    },
  };

  beforeEach(() => {
    clearCsrfToken();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/csrf-token")) {
          return Promise.resolve(
            mockFetchResponse({ csrfToken: "test-csrf" }),
          );
        }
        return mockFetch(input, init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("useWeeklyRecapData", () => {
    it("fetches weekly recap data", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: mockRecapData,
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useWeeklyRecapData(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockRecapData);
    });

    it("calls correct API endpoint", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: mockRecapData,
        })
      );

      const { wrapper } = createWrapper();
      renderHook(() => useWeeklyRecapData(), { wrapper });

      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/weekly-recap",
          expect.objectContaining({ credentials: "include" })
        )
      );
    });

    it("returns properly typed data structure", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: mockRecapData,
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useWeeklyRecapData(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const data = result.current.data;

      // Verify net worth structure
      expect(typeof data?.netWorth.current).toBe("number");
      expect(typeof data?.netWorth.previous).toBe("number");
      expect(typeof data?.netWorth.change).toBe("number");
      expect(typeof data?.netWorth.changePercent).toBe("number");
      expect(Array.isArray(data?.netWorth.series)).toBe(true);
      expect(["up", "down", "steady"]).toContain(data?.netWorth.trend);

      // Verify spending structure
      expect(typeof data?.spending.total).toBe("number");
      expect(Array.isArray(data?.spending.topCategories)).toBe(true);
      expect(typeof data?.spending.hasData).toBe("boolean");

      // Verify recurring structure
      expect(Array.isArray(data?.recurring.upcoming)).toBe(true);
      expect(typeof data?.recurring.count).toBe("number");
      expect(typeof data?.recurring.totalAmount).toBe("number");
    });

    it("has net worth series with proper date and value", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: mockRecapData,
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useWeeklyRecapData(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const series = result.current.data?.netWorth.series;
      expect(series).toHaveLength(2);
      expect(series?.[0]).toHaveProperty("date");
      expect(series?.[0]).toHaveProperty("value");
      expect(typeof series?.[0].date).toBe("string");
      expect(typeof series?.[0].value).toBe("number");
    });

    it("has spending categories with proper structure", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: mockRecapData,
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useWeeklyRecapData(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const categories = result.current.data?.spending.topCategories;
      expect(categories).toHaveLength(2);
      // Verify aligned field names per CONTRACT-001/002
      expect(categories?.[0]).toHaveProperty("categoryId");
      expect(categories?.[0]).toHaveProperty("name"); // Was "categoryName"
      expect(categories?.[0]).toHaveProperty("amount");
      expect(categories?.[0]).toHaveProperty("percent");
    });

    it("has recurring items with proper structure", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
          data: mockRecapData,
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useWeeklyRecapData(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const upcoming = result.current.data?.recurring.upcoming;
      expect(upcoming).toHaveLength(2);
      // Verify aligned field names per CONTRACT-003/004
      expect(upcoming?.[0]).toHaveProperty("id");
      expect(upcoming?.[0]).toHaveProperty("name");
      expect(upcoming?.[0]).toHaveProperty("amount");
      expect(typeof upcoming?.[0].amount).toBe("number"); // Was string
      expect(upcoming?.[0]).toHaveProperty("dueDate"); // Was "date"
      expect(upcoming?.[0]).toHaveProperty("frequency");
    });
  });

  describe("useWeeklyRecapFeedback", () => {
    it("submits feedback successfully", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useWeeklyRecapFeedback(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          step: "spending",
          feedback: "positive",
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/weekly-recap/feedback",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "x-csrf-token": "test-csrf",
          }),
          credentials: "include",
          body: JSON.stringify({
            step: "spending",
            feedback: "positive",
            weekStart: "2026-01-20",
            weekEnd: "2026-01-26",
          }),
        })
      );
    });

    it("accepts both positive and negative feedback", async () => {
      mockFetch.mockResolvedValue(
        mockFetchResponse({
          success: true,
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useWeeklyRecapFeedback(), { wrapper });

      // Test positive feedback
      await act(async () => {
        await result.current.mutateAsync({
          step: "net-worth",
          feedback: "positive",
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/weekly-recap/feedback",
        expect.objectContaining({
          body: expect.stringContaining('"feedback":"positive"'),
        })
      );

      // Test negative feedback
      await act(async () => {
        await result.current.mutateAsync({
          step: "recurring",
          feedback: "negative",
          weekStart: "2026-01-20",
          weekEnd: "2026-01-26",
        });
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/weekly-recap/feedback",
        expect.objectContaining({
          body: expect.stringContaining('"feedback":"negative"'),
        })
      );
    });
  });
});
