import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { useInfiniteTransactions, useTransactions, useUpdateTransaction } from "../useTransactions";

const api = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/api", () => ({ transactionsApi: api, generateIdempotencyKey: () => "unused" }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../useAccounts", () => ({ accountKeys: { all: ["accounts"] } }));
vi.mock("../use-reports", () => ({ invalidateReportsForChange: vi.fn() }));

it.each([true, false])("refreshes the actual active infinite list after explicit private=%s without a tag mutation", async isPrivate => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  const original = { id: "transaction", name: "Rent payment 42", isPrivate: !isPrivate };
  const updated = { ...original, isPrivate };
  const page = (row: typeof original) => ({ transactions: [row], pagination: { offset: 0, pageSize: 1, totalCount: 1 } });
  api.list.mockReset().mockResolvedValueOnce(page(original)).mockResolvedValue(page(updated)); api.update.mockReset().mockResolvedValue(updated);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({ feed: useInfiniteTransactions({ accountId: "shared-account" }), edit: useUpdateTransaction() }), { wrapper });
  await waitFor(() => expect(hook.result.current.feed.data?.pages[0].transactions[0].isPrivate).toBe(!isPrivate));
  await act(async () => { await hook.result.current.edit.mutateAsync({ id: original.id, data: { isPrivate } }); });
  await waitFor(() => expect(hook.result.current.feed.data?.pages[0].transactions[0].isPrivate).toBe(isPrivate));
  expect(api.list).toHaveBeenCalledTimes(2); expect(api.update).toHaveBeenCalledWith(original.id, { isPrivate });
  hook.unmount(); client.clear();
});
it.each([true, false])("refreshes an actual filtered account list after explicit private=%s", async isPrivate => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  const original = { id: "transaction", name: "Rent payment 42", isPrivate: !isPrivate }, updated = { ...original, isPrivate };
  const page = (row: typeof original) => ({ transactions: [row], pagination: { offset: 0, pageSize: 1, totalCount: 1 } });
  api.list.mockReset().mockResolvedValueOnce(page(original)).mockResolvedValue(page(updated)); api.update.mockReset().mockResolvedValue(updated);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({ feed: useTransactions({ accountId: "shared-account" }), edit: useUpdateTransaction() }), { wrapper });
  await waitFor(() => expect(hook.result.current.feed.data?.transactions[0].isPrivate).toBe(!isPrivate));
  await act(async () => { await hook.result.current.edit.mutateAsync({ id: original.id, data: { isPrivate } }); });
  await waitFor(() => expect(hook.result.current.feed.data?.transactions[0].isPrivate).toBe(isPrivate));
  expect(api.list).toHaveBeenCalledTimes(2); hook.unmount(); client.clear();
});
