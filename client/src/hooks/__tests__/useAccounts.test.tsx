/**
 * useAccounts Hook Tests
 *
 * Tests for the accounts data fetching hooks:
 * - Account list fetching
 * - Single account fetching
 * - Net worth summary
 * - Balance history
 * - Account mutations (create, update, delete, archive)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ReactNode } from "react";
import { ImportTransactionsModal } from "@/components/accounts/ImportTransactionsModal";
import { clearCsrfToken, IMPORT_REVIEW_REQUIRED } from "@/lib/api";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { protectedFetch } from "@/lib/protected-fetch";
import { useReportsDebt, useReportsNetWorth, useReportsTransactions } from "../use-reports";

vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: vi.fn() }));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ timezone: "Africa/Lusaka" }) }));

// Mock toast
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

// Mock the API client.
// Defined via vi.hoisted so the object exists before vi.mock factories run
// (vi.mock is hoisted above all imports/top-level declarations).
const { mockAccountsApi } = vi.hoisted(() => ({
  mockAccountsApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getSummary: vi.fn(),
    getBalanceHistory: vi.fn(),
    getNetWorthHistory: vi.fn(),
    adjustBalance: vi.fn(),
    importTransactions: vi.fn(),
    archive: vi.fn(),
    unarchive: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

vi.mock("@/lib/api", async original => ({
  ...await original<typeof import("@/lib/api")>(),
  accountsApi: mockAccountsApi,
}));

const createWrapper = (gcTime = 0) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
};

// Import after mocks
import {
  useAccounts,
  useAccount,
  useNetWorthSummary,
  useAccountBalanceHistory,
  useNetWorthHistory,
  useCreateAccount,
  useUpdateAccount,
  useDeleteAccount,
  useAdjustBalance,
  useImportTransactions,
  useArchiveAccount,
} from "../useAccounts";

describe("useAccounts Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows possible duplicate names and amounts before sending the same statement with explicit choices", async () => {
    const { accountsApi } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    mockAccountsApi.importTransactions.mockImplementationOnce(accountsApi.importTransactions)
      .mockImplementationOnce(accountsApi.importTransactions);
    const [shopMatch, fuelMatch] = ["48b484b3-5de0-4d9e-a11f-c1122acb832f", "47b1844c-84b3-4a93-8772-b4b9ecb80744"];
    const rows = [{ date: "2026-05-04", merchant: "Shop", amount: "-25.00" },
      { date: "2026-05-05", merchant: "Fuel", amount: "-12.40" }];
    const review = rows.map((row, index) => ({ row: index + 1, matchesTransactionId: [shopMatch, fuelMatch][index],
      match: { name: index === 0 ? "Previous corner shop" : "Previous fuel stop", date: row.date, type: "expense",
        amount: { amount: row.amount.slice(1), currency: "USD" } } }));
    const endpoint = "/api/accounts/card/transactions/import";
    const fetch = vi.mocked(protectedFetch);
    fetch.mockResolvedValueOnce(Response.json({ success: false, error: { code: IMPORT_REVIEW_REQUIRED,
      message: "Review possible duplicates", details: { possibleDuplicates: review } } }, { status: 409 }));
    fetch.mockResolvedValueOnce(Response.json({ success: true, data: { imported: 1, totalAmount: -25, skipped: 0,
      reviewSkipped: 1, possibleDuplicates: [{ row: 1, transactionId: "new-shop", matchesTransactionId: shopMatch }] } }));
    const csrf = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ csrfToken: "synthetic-csrf" }));
    clearCsrfToken();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    try {
      render(<ImportTransactionsModal accountId="card" accountName="Synthetic card" open onOpenChange={onOpenChange} />,
        { wrapper: createWrapper() });
      const csv = ["Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags",
        ...rows.map(row => `${row.date},${row.merchant},,,,,${row.amount},`)].join("\n");
      fireEvent.change(document.querySelector('input[type="file"]')!, { target: {
        files: [new File([csv], "statement.csv", { type: "text/csv" })],
      } });
      await user.click(screen.getByRole("switch", { name: "Adjust account's balance" }));
      await user.click(await screen.findByRole("button", { name: "Add 2 transactions" }));

      const warning = within(await screen.findByTestId("account-import-review"));
      expect(warning.getByText(/Nothing has been imported yet/)).toBeVisible();
      expect(warning.getByText(/“Previous corner shop” on 2026-05-04 \(-25\.00 USD\)/)).toBeVisible();
      expect(warning.getByText(/“Previous fuel stop” on 2026-05-05 \(-12\.40 USD\)/)).toBeVisible();
      const shop = warning.getByRole("checkbox", { name: /Skip row 1: Shop/ });
      const fuel = warning.getByRole("checkbox", { name: /Skip row 2: Fuel/ });
      expect(shop).toBeChecked();
      expect(fuel).toBeChecked();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ transactions: rows, adjustBalance: true,
        possibleDuplicateDecisions: [] });
      expect(toastMock).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();

      await user.click(shop);
      expect(fuel).toBeChecked();
      await user.click(screen.getByRole("button", { name: "Import with these choices" }));
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls.map(([path, init]) => [path, init?.method])).toEqual([[endpoint, "POST"], [endpoint, "POST"]]);
      expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ transactions: rows, adjustBalance: true,
        possibleDuplicateDecisions: [{ row: 1, matchesTransactionId: shopMatch, decision: "post" },
          { row: 2, matchesTransactionId: fuelMatch, decision: "skip" }] });
      expect(toastMock).toHaveBeenCalledWith({ title: "Transactions imported",
        description: "1 transactions have been added. 1 possible duplicate was skipped." });
    } finally {
      csrf.mockRestore();
      clearCsrfToken();
    }
  });

  it("preserves the partial error and skips refetch if the household changes during cancellation", async () => {
    const original = createOperationLifetime(), replacement = createOperationLifetime();
    activateOperationLifetime(original);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const error = Object.assign(new Error("Second row failed"), { code: "ACCOUNT_IMPORT_INCOMPLETE" });
    mockAccountsApi.importTransactions.mockRejectedValueOnce(error);
    const { result } = renderHook(() => ({ client: useQueryClient(), importCsv: useImportTransactions() }),
      { wrapper: createWrapper() });
    const cancel = vi.spyOn(result.current.client, "cancelQueries").mockReturnValueOnce(barrier);
    const refetch = vi.spyOn(result.current.client, "invalidateQueries");
    try {
      const rejected = expect(result.current.importCsv.mutateAsync({
        id: "card", transactions: [{ date: "2026-01-10", merchant: "Shop", amount: "-45.50" }], adjustBalance: true,
      })).rejects.toBe(error);
      await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
      activateOperationLifetime(replacement);
      await act(async () => { release(); await rejected; });
      expect(refetch).not.toHaveBeenCalled();
    } finally {
      release();
      retireOperationLifetime(replacement);
      retireOperationLifetime(original);
    }
  });

  it.each(["success", "partial"])("discards the first pending net-worth read after CSV %s", async outcome => {
    let releaseOld!: (value: Response) => void;
    const old = new Promise<Response>(resolve => { releaseOld = resolve; });
    const report = (amount: string) => Response.json({
      success: true, data: { latest: { netWorth: { amount, currency: "ZMW" } } },
    });
    const fetch = vi.mocked(protectedFetch);
    fetch.mockImplementationOnce(() => old).mockImplementation(() => Promise.resolve(report("4454.50")));
    const incomplete = Object.assign(new Error("Second row failed"), {
      code: "ACCOUNT_IMPORT_INCOMPLETE", details: { imported: 1, failedRow: 2 },
    });
    if (outcome === "partial") mockAccountsApi.importTransactions.mockRejectedValueOnce(incomplete);
    else mockAccountsApi.importTransactions.mockResolvedValueOnce({ imported: 1, totalAmount: -45.50 });
    const { result } = renderHook(() => ({
      worth: useReportsNetWorth({ from: "2026-01-01", to: "2026-01-31" }),
      importCsv: useImportTransactions(),
    }), { wrapper: createWrapper() });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(result.current.worth.data).toBeUndefined();
    const row = { date: "2026-01-10", merchant: "Shop", amount: "-45.50" };
    await act(async () => {
      const pending = result.current.importCsv.mutateAsync({
        id: "card", transactions: outcome === "partial" ? [row, { ...row, merchant: "Second" }] : [row], adjustBalance: true,
      });
      if (outcome === "partial") await expect(pending).rejects.toBe(incomplete);
      else await pending;
    });
    try {
      await waitFor(() => expect(result.current.worth.data?.latest.netWorth.amount).toBe("4454.50"));
    } finally {
      await act(async () => { releaseOld(report("4500.00")); await old; });
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.current.worth.data?.latest.netWorth.amount).toBe("4454.50");
  });

  it.each([
    { adjustBalance: true, partial: false },
    { adjustBalance: false, partial: false },
    { adjustBalance: true, partial: true },
  ])("refreshes the mounted reports after CSV import with adjustBalance=$adjustBalance and partial=$partial", async ({ adjustBalance, partial }) => {
    const accountId = "card";
    const range = { from: "2026-01-01", to: "2026-01-31" };
    const row = { date: "2026-01-10", merchant: "Card purchase", amount: "-45.50" };
    let imported = false;
    const error = Object.assign(new Error("The second row failed"), {
      code: "ACCOUNT_IMPORT_INCOMPLETE", details: { imported: 1, failedRow: 2 },
    });
    mockAccountsApi.importTransactions.mockImplementation(async () => {
      imported = true;
      if (partial) throw error;
      return { imported: 1, totalAmount: -45.50 };
    });
    vi.mocked(protectedFetch).mockImplementation(async input => {
      const { pathname } = new URL(String(input), "http://localhost");
      if (pathname === "/api/reports/transactions") {
        return Response.json({ success: true, data: { items: imported ? [{ id: "purchase" }] : [] } });
      }
      if (pathname === "/api/reports/debt") {
        const amount = imported && adjustBalance ? "545.50" : "500.00";
        return Response.json({ success: true, data: { totalDebt: { amount, currency: "ZMW" } } });
      }
      if (pathname === "/api/reports/net-worth") {
        const amount = imported && adjustBalance ? "4454.50" : "4500.00";
        return Response.json({ success: true, data: { latest: { netWorth: { amount, currency: "ZMW" } } } });
      }
      throw new Error("Unexpected report URL " + pathname);
    });
    const { result } = renderHook(() => ({
      client: useQueryClient(), importCsv: useImportTransactions(), debt: useReportsDebt(range),
      netWorth: useReportsNetWorth(range),
      transactions: useReportsTransactions({ ...range, accountId }),
    }), { wrapper: createWrapper(Infinity) });
    await waitFor(() => {
      expect(result.current.netWorth.data?.latest.netWorth.amount).toBe("4500.00");
      expect(result.current.transactions.data?.items).toEqual([]);
      expect(result.current.debt.data?.totalDebt.amount).toBe("500.00");
      expect(result.current.netWorth.isStale).toBe(false);
    });
    const rows = partial ? [row, { ...row, merchant: "Second merchant" }] : [row];
    const affected = [["budgets", "progress", 2026, 1], ["tags", "list"], ["merchants", "transactions", "shop"]];
    for (const key of affected) result.current.client.setQueryData(key, []);
    await act(async () => {
      const outcome = result.current.importCsv.mutateAsync({ id: accountId, transactions: rows, adjustBalance });
      if (partial) await expect(outcome).rejects.toBe(error);
      else await outcome;
    });
    expect(mockAccountsApi.importTransactions).toHaveBeenCalledTimes(1);
    expect(mockAccountsApi.importTransactions).toHaveBeenCalledWith(accountId, rows, adjustBalance, []);
    await waitFor(() => {
      expect(result.current.netWorth.data?.latest.netWorth).toEqual({ amount: adjustBalance ? "4454.50" : "4500.00", currency: "ZMW" });
      expect(result.current.transactions.data?.items).toEqual([{ id: "purchase" }]);
      expect(result.current.debt.data?.totalDebt).toEqual({ amount: adjustBalance ? "545.50" : "500.00", currency: "ZMW" });
      for (const key of affected) expect(result.current.client.getQueryState(key)?.isInvalidated).toBe(true);
    });
  });

  describe("Data Fetching", () => {
    it("does not dispatch account, summary, or history queries until saved-filter restoration enables them", async () => {
      mockAccountsApi.list.mockResolvedValue([]);
      mockAccountsApi.getSummary.mockResolvedValue({ totalAssets: 0, totalLiabilities: 0, netWorth: 0 });
      mockAccountsApi.getNetWorthHistory.mockResolvedValue({ series: [] });
      const { rerender } = renderHook(({ enabled }) => {
        useAccounts({ ownerUserId: "all" }, enabled);
        useNetWorthSummary(enabled);
        useNetWorthHistory("1m", "user", enabled);
      }, { initialProps: { enabled: false }, wrapper: createWrapper() });
      expect(mockAccountsApi.list).not.toHaveBeenCalled();
      expect(mockAccountsApi.getSummary).not.toHaveBeenCalled();
      expect(mockAccountsApi.getNetWorthHistory).not.toHaveBeenCalled();
      rerender({ enabled: true });
      await waitFor(() => expect(mockAccountsApi.list).toHaveBeenCalledTimes(1));
      expect(mockAccountsApi.getSummary).toHaveBeenCalledTimes(1);
      expect(mockAccountsApi.getNetWorthHistory).toHaveBeenCalledTimes(1);
    });
    it("should fetch accounts successfully", async () => {
      const mockData = [
        { id: "acc-1", name: "Checking", balance: { amount: "1000.00", currency: "ZMW" } },
        { id: "acc-2", name: "Savings", balance: { amount: "5000.00", currency: "ZMW" } },
      ];
      mockAccountsApi.list.mockResolvedValue(mockData);

      const { result } = renderHook(() => useAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockData);
    });

    it("should handle loading state", async () => {
      mockAccountsApi.list.mockImplementation(
        () => new Promise(() => {})
      );

      const { result } = renderHook(() => useAccounts(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it("should handle error state", async () => {
      const error = new Error("Failed to fetch accounts");
      mockAccountsApi.list.mockRejectedValue(error);

      const { result } = renderHook(() => useAccounts(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
    });
  });

  describe("Filtering", () => {
    it("should include archived accounts when specified", async () => {
      mockAccountsApi.list.mockResolvedValue([]);

      renderHook(() => useAccounts({ includeArchived: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockAccountsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({ includeArchived: true })
        );
      });
    });

    it("should include hidden accounts when specified", async () => {
      mockAccountsApi.list.mockResolvedValue([]);

      renderHook(() => useAccounts({ includeHidden: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockAccountsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({ includeHidden: true })
        );
      });
    });

    it("should filter by owner user id", async () => {
      mockAccountsApi.list.mockResolvedValue([]);

      renderHook(() => useAccounts({ ownerUserId: "user-123" }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockAccountsApi.list).toHaveBeenCalledWith(
          expect.objectContaining({ ownerUserId: "user-123" })
        );
      });
    });
  });
});

describe("useAccount Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch a single account", async () => {
    const mockAccount = {
      id: "acc-1",
      name: "Checking",
      balance: { amount: "1000.00", currency: "ZMW" },
      type: "checking",
    };
    mockAccountsApi.get.mockResolvedValue(mockAccount);

    const { result } = renderHook(() => useAccount("acc-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockAccount);
  });

  it("should not fetch when id is empty", async () => {
    renderHook(() => useAccount(""), {
      wrapper: createWrapper(),
    });

    expect(mockAccountsApi.get).not.toHaveBeenCalled();
  });
});

describe("useNetWorthSummary Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch net worth summary", async () => {
    const mockSummary = {
      totalAssets: { amount: "15000.00", currency: "ZMW" },
      totalLiabilities: { amount: "5000.00", currency: "ZMW" },
      netWorth: { amount: "10000.00", currency: "ZMW" },
    };
    mockAccountsApi.getSummary.mockResolvedValue(mockSummary);

    const { result } = renderHook(() => useNetWorthSummary(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockSummary);
  });
});

describe("useAccountBalanceHistory Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch balance history", async () => {
    const mockHistory = [
      { date: "2026-01-01", balance: "1000.00" },
      { date: "2026-01-15", balance: "1200.00" },
      { date: "2026-01-31", balance: "1100.00" },
    ];
    mockAccountsApi.getBalanceHistory.mockResolvedValue(mockHistory);

    const { result } = renderHook(() => useAccountBalanceHistory("acc-1", "1m"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockHistory);
    expect(mockAccountsApi.getBalanceHistory).toHaveBeenCalledWith("acc-1", "1m");
  });
});

describe("useNetWorthHistory Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch net worth history", async () => {
    const mockHistory = [
      { date: "2026-01-01", netWorth: "10000.00" },
      { date: "2026-01-31", netWorth: "11000.00" },
    ];
    mockAccountsApi.getNetWorthHistory.mockResolvedValue(mockHistory);

    const { result } = renderHook(() => useNetWorthHistory("1m"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(mockHistory);
  });

  it("should accept scope parameter", async () => {
    mockAccountsApi.getNetWorthHistory.mockResolvedValue([]);

    renderHook(() => useNetWorthHistory("1m", "household"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockAccountsApi.getNetWorthHistory).toHaveBeenCalledWith("1m", "household");
    });
  });
});

describe("Account Mutation Hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create an account", async () => {
    const newAccount = {
      id: "acc-new",
      name: "New Account",
      balance: { amount: "0.00", currency: "ZMW" },
    };
    mockAccountsApi.create.mockResolvedValue(newAccount);

    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      name: "New Account",
      type: "checking",
      currency: "ZMW",
    });

    expect(mockAccountsApi.create).toHaveBeenCalled();
  });

  it("should update an account", async () => {
    const updatedAccount = {
      id: "acc-1",
      name: "Updated Account",
    };
    mockAccountsApi.update.mockResolvedValue(updatedAccount);

    const { result } = renderHook(() => useUpdateAccount(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      id: "acc-1",
      data: { name: "Updated Account" },
    });

    expect(mockAccountsApi.update).toHaveBeenCalledWith("acc-1", { name: "Updated Account" });
  });

  it("should delete an account", async () => {
    mockAccountsApi.delete.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useDeleteAccount(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync("acc-1");

    expect(mockAccountsApi.delete).toHaveBeenCalledWith("acc-1");
  });

  it("should adjust balance", async () => {
    const adjustedAccount = {
      id: "acc-1",
      balance: { amount: "1500.00", currency: "ZMW" },
    };
    mockAccountsApi.adjustBalance.mockResolvedValue({ account: adjustedAccount });

    const { result } = renderHook(() => useAdjustBalance(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({
      id: "acc-1",
      data: {
        amount: 500,
        isIncrease: true,
      },
    });

    expect(mockAccountsApi.adjustBalance).toHaveBeenCalledWith(
      "acc-1",
      expect.objectContaining({
        amount: 500,
        isIncrease: true,
      })
    );
  });

  it("should archive an account", async () => {
    const archivedAccount = {
      id: "acc-1",
      name: "Archived Account",
      isArchived: true,
    };
    mockAccountsApi.archive.mockResolvedValue(archivedAccount);

    const { result } = renderHook(() => useArchiveAccount(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({ id: "acc-1", archive: true });

    expect(mockAccountsApi.archive).toHaveBeenCalledWith("acc-1");
  });

  it("should unarchive an account", async () => {
    const unarchivedAccount = {
      id: "acc-1",
      name: "Active Account",
      isArchived: false,
    };
    mockAccountsApi.unarchive.mockResolvedValue(unarchivedAccount);

    const { result } = renderHook(() => useArchiveAccount(), {
      wrapper: createWrapper(),
    });

    await result.current.mutateAsync({ id: "acc-1", archive: false });

    expect(mockAccountsApi.unarchive).toHaveBeenCalledWith("acc-1");
  });

  it("should handle mutation error", async () => {
    const error = new Error("Failed to create account");
    mockAccountsApi.create.mockRejectedValue(error);

    const { result } = renderHook(() => useCreateAccount(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({
        name: "Test",
        type: "checking",
        currency: "ZMW",
      })
    ).rejects.toThrow();
  });
});
