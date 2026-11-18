import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAccountDetail } from "../hooks/useAccountDetail";
import { TestWrapper as Wrapper } from "@/test/test-utils";

// Mock the API hooks
const mockUseAccount = vi.fn();
const mockUseAccountBalanceHistory = vi.fn();
const mockUseTransactions = vi.fn();

vi.mock("@/hooks", () => ({
  useAccount: (id: string) => mockUseAccount(id),
  useAccountBalanceHistory: (id: string) => mockUseAccountBalanceHistory(id),
  useTransactions: (params: any) => mockUseTransactions(params),
  useExportTransactions: () => ({ mutate: vi.fn() }),
  useExportBalanceHistory: () => ({ mutate: vi.fn() }),
}));

describe("useAccountDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockAccount = {
    id: "acc-123",
    name: "Test Checking",
    balance: "5000.00",
    currency: "USD",
  };

  it("should return account data when loaded", async () => {
    mockUseAccount.mockReturnValue({
      data: mockAccount,
      isLoading: false,
    });
    mockUseAccountBalanceHistory.mockReturnValue({
      data: [],
      isLoading: false,
    });
    mockUseTransactions.mockReturnValue({
      data: { transactions: [] },
      isLoading: false,
    });

    const { result } = renderHook(() => useAccountDetail("acc-123"), {
      wrapper: Wrapper,
    });

    expect(result.current.account).toEqual(mockAccount);
    expect(result.current.accountLoading).toBe(false);
  });

  it("should return balance history and chart data", () => {
    mockUseAccount.mockReturnValue({ data: mockAccount, isLoading: false });
    mockUseAccountBalanceHistory.mockReturnValue({
      data: [
        { date: "2024-01-01", balance: 4000 },
        { date: "2024-01-02", balance: 5000 },
      ],
      isLoading: false,
    });
    mockUseTransactions.mockReturnValue({
      data: { transactions: [] },
      isLoading: false,
    });

    const { result } = renderHook(() => useAccountDetail("acc-123"), {
      wrapper: Wrapper,
    });

    expect(result.current.balanceHistory).toHaveLength(2);
    expect(result.current.chartData).toHaveLength(2);
    expect(result.current.chartData[0]).toHaveProperty("date");
    expect(result.current.chartData[0]).toHaveProperty("value");
  });

  it("should return transactions array", () => {
    mockUseAccount.mockReturnValue({ data: mockAccount, isLoading: false });
    mockUseAccountBalanceHistory.mockReturnValue({
      data: [],
      isLoading: false,
    });
    mockUseTransactions.mockReturnValue({
      data: {
        transactions: [
          {
            id: "1",
            date: "2024-01-01T10:00:00Z",
            amount: -50,
            name: "Groceries",
          },
          {
            id: "2",
            date: "2024-01-01T14:00:00Z",
            amount: -20,
            name: "Coffee",
          },
          {
            id: "3",
            date: "2024-01-02T09:00:00Z",
            amount: 1000,
            name: "Salary",
          },
        ],
      },
      isLoading: false,
    });

    const { result } = renderHook(() => useAccountDetail("acc-123"), {
      wrapper: Wrapper,
    });

    expect(result.current.transactions).toHaveLength(3);
    expect(result.current.transactionsLoading).toBe(false);
  });
});
