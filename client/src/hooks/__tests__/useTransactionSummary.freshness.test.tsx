/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListTransactionsParams, TransactionSummary } from "@/lib/api";

const { getSummary } = vi.hoisted(() => ({ getSummary: vi.fn() }));
vi.mock("@/lib/api", () => ({ transactionsApi: { getSummary }, generateIdempotencyKey: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../useAccounts", () => ({ accountKeys: { all: ["accounts"] } }));
import { useTransactionSummary } from "../useTransactions";

type Filters = Omit<ListTransactionsParams, "startDate" | "endDate" | "limit" | "offset">;
const reply = (amount: string): TransactionSummary => ({ totalIncome: { amount, currency: "USD" },
  totalExpenses: { amount: "0.00", currency: "USD" }, netFlow: { amount, currency: "USD" }, transactionCount: 1 });
let clients: QueryClient[];
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => { clients = []; getSummary.mockReset(); });
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); });

describe("FIN-17 exported summary filter identity and displayed-data freshness", () => {
  it("separates every supported filter at the same dates instead of reusing another total", async () => {
    const base: Filters = { ownerUserId: null, accountId: "account-a", categoryId: "category-a", merchantId: "merchant-a",
      type: "expense", search: "groceries", amountMin: 10, amountMax: 100, reviewed: "unreviewed", tagIds: ["tag-a"] };
    const variants: Filters[] = [
      { ...base, ownerUserId: "owner-b" }, { ...base, accountId: "account-b" }, { ...base, categoryId: "category-b" },
      { ...base, merchantId: "merchant-b" }, { ...base, type: "income" }, { ...base, search: "salary" },
      { ...base, amountMin: 20 }, { ...base, amountMax: 200 }, { ...base, reviewed: "reviewed" }, { ...base, tagIds: ["tag-b"] },
    ];
    let calls = 0;
    getSummary.mockImplementation(async () => reply(`${++calls}.00`));
    const { result, rerender } = renderHook(({ filters }: { filters: Filters }) => useTransactionSummary("2026-02-01", "2026-02-28", filters),
      { wrapper: wrapper(), initialProps: { filters: base } });
    await waitFor(() => expect(result.current.data?.totalIncome.amount).toBe("1.00"));
    expect(getSummary).toHaveBeenLastCalledWith({ startDate: "2026-02-01", endDate: "2026-02-28", ...base }, expect.any(AbortSignal));
    for (const [index, filters] of variants.entries()) {
      rerender({ filters });
      await waitFor(() => expect(result.current.data?.totalIncome.amount).toBe(`${index + 2}.00`));
      expect(getSummary).toHaveBeenLastCalledWith({ startDate: "2026-02-01", endDate: "2026-02-28", ...filters }, expect.any(AbortSignal));
    }
    expect(getSummary).toHaveBeenCalledTimes(11);
    expect(clients[0].getQueryCache().getAll()).toHaveLength(11);
  });

  it("withholds an older exported-hook result during refresh and after a typed failure", async () => {
    getSummary.mockResolvedValueOnce(reply("100.00"));
    const { result } = renderHook(() => useTransactionSummary("2026-02-01", "2026-02-28"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.totalIncome.amount).toBe("100.00"));
    let reject!: (error: Error) => void;
    getSummary.mockImplementationOnce(() => new Promise<TransactionSummary>((_resolve, fail) => { reject = fail; }));
    act(() => { void result.current.refetch(); });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data).toBeUndefined();
    await act(async () => { reject(Object.assign(new Error("Trusted FX unavailable"), { status: 422, code: "FINANCIAL_DATA_UNAVAILABLE" })); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toMatchObject({ status: 422, code: "FINANCIAL_DATA_UNAVAILABLE" });
  });
});