import { renderHook, waitFor } from "@testing-library/react";
import { useAccountsData } from "../hooks/useAccountsData";
import { useAccounts, useNetWorthSummary, useNetWorthHistory } from "@/hooks";
import { TestWrapper } from "@/test/test-utils";
import { vi, Mock } from "vitest";
vi.mock("../hooks/useAccountOwnerPreference", () => ({ useAccountOwnerPreference: () => ({ ownerUserId: "all", ownerPreferencesReady: true, ownerPreferencesLoading: false }) }));

// Mock the API hooks
vi.mock("@/hooks", async () => {
  const actual = await vi.importActual("@/hooks");
  return {
    ...actual,
    useAccounts: vi.fn(),
    useNetWorthSummary: vi.fn(),
    useNetWorthHistory: vi.fn(),
    useExportAccountsSummary: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false,
    })),
  };
});

const mockAccounts = [
  {
    id: "1",
    type: "checking",
    name: "Bank 1",
    balance: "1000",
    ownerUserId: null,
  },
  {
    id: "2",
    type: "credit",
    name: "Card 1",
    balance: "-500",
    ownerUserId: null,
  },
];

describe("useAccountsData", () => {
  beforeEach(() => {
    (useAccounts as Mock).mockReturnValue({
      data: mockAccounts,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    (useNetWorthSummary as Mock).mockReturnValue({
      data: { totalAssets: 1000, totalLiabilities: 500, netWorth: 500 },
      isLoading: false,
    });
    (useNetWorthHistory as Mock).mockReturnValue({
      data: { accounts: mockAccounts, series: [], currentStatus: "available", latest: { assets: 1000, liabilities: 500, netWorth: 500, currency: "ZMW" } },
      isLoading: false,
    });
  });

  it("calculates grouped accounts correctly", () => {
    const { result } = renderHook(() => useAccountsData(), {
      wrapper: TestWrapper,
    });

    expect(result.current.groupedAccounts["Banks"]).toHaveLength(1);
    expect(result.current.groupedAccounts["Credit Cards"]).toHaveLength(1);
  });

  it("calculates summary data correctly", () => {
    const { result } = renderHook(() => useAccountsData(), {
      wrapper: TestWrapper,
    });

    expect(result.current.summaryData.totalAssets).toBe(1000);
    expect(result.current.summaryData.totalLiabilities).toBe(500);
    expect(result.current.summaryData.netWorthValue).toBe(500);
  });

  it("requests the coherent list frame after preferences are ready", () => {
    renderHook(() => useAccountsData(), {
      wrapper: TestWrapper,
    });

    expect(useNetWorthHistory).toHaveBeenCalledWith("1m", "user", true, true, undefined, 0, expect.any(String));
    expect(useAccounts).not.toHaveBeenCalled();
  });

  it("retains captured currency and calendar date instead of relabelling old values", () => {
    (useNetWorthHistory as Mock).mockReturnValue({ data: { accounts: mockAccounts, series: [
      { date: "2026-10-31", netWorth: 50, assets: 50, liabilities: 0, currency: "ZMW", provenance: "captured_snapshot" },
    ] }, isLoading: false });
    const { result } = renderHook(() => useAccountsData(), { wrapper: TestWrapper });
    expect(result.current.chartData).toEqual([expect.objectContaining({ date: "2026-10-31", currency: "ZMW", value: 50 })]);
  });
  it("does not fabricate historical points from current summary or unattested independent rows", () => {
    (useNetWorthHistory as Mock).mockReturnValue({ data: { accounts: mockAccounts, series: [
      { date: "2026-10-31", netWorth: 123456, assets: 123456, liabilities: 0 },
    ] }, isLoading: false });
    const { result } = renderHook(() => useAccountsData(), { wrapper: TestWrapper });
    expect(result.current.chartData).toEqual([]);
  });
  it("keeps a proven dated point even if current valuation is unavailable", () => {
    (useNetWorthSummary as Mock).mockReturnValue({ data: undefined, isLoading: false, error: new Error("Visible valuation unavailable") });
    (useNetWorthHistory as Mock).mockReturnValue({ data: { accounts: mockAccounts, latest: null, currentStatus: "unavailable", series: [
      { date: "2026-10-31", netWorth: 50, assets: 50, liabilities: 0, currency: "ZMW", provenance: "captured_snapshot" },
    ] }, isLoading: false });
    const { result } = renderHook(() => useAccountsData(), { wrapper: TestWrapper });
    expect(result.current.chartData).toHaveLength(1);
    expect(result.current.summaryData.available).toBe(false);
  });
});
