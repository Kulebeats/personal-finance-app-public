import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Transaction } from "@/lib/api";
import { useTransactionForm } from "./useTransactionForm";

const update = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/hooks/useTransactions", () => ({
  useCreateTransaction: () => ({}), useUpdateTransaction: () => ({}), useDeleteTransaction: () => ({}),
  useCreateTransfer: () => ({}), useUpdateTransfer: () => ({ mutateAsync: update }),
}));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [{ id: "cash", currency: "USD" }, { id: "savings", currency: "USD" }] }) }));
vi.mock("@/hooks/useCategories", () => ({ useCategories: () => ({}) }));
vi.mock("@/hooks/useGoals", () => ({
  useGoals: () => ({}), useLinkTransaction: () => ({}), useTransactionGoalLinks: () => ({}),
  useUnlinkTransactionFromGoal: () => ({}),
}));
vi.mock("@/hooks/use-settings", () => ({
  useProfile: () => ({ data: { id: "actor" } }),
  useCreateMerchant: () => ({}), useUpdateMerchant: () => ({}), useUserPreferences: () => ({}),
}));
vi.mock("@/hooks/useRecurring", () => ({ useCreateRecurringTransaction: () => ({}) }));
vi.mock("@/hooks", () => ({
  useTransactionTags: () => ({}), useSetTransactionTags: () => ({}), useAddTagsToTransaction: () => ({}),
}));
vi.mock("@/hooks/useTransactionReceipt", () => ({ useTransactionReceipt: () => ({}) }));
vi.mock("@/hooks/useTransactionAttachments", () => ({ useTransactionAttachments: () => ({ clearAttachments() {} }) }));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ currency: "USD" }) }));

it("submits the version that initialized a transfer draft and refreshes it on reopen", async () => {
  const original: Transaction = {
    id: "inflow", householdId: "household", accountId: "savings", transferAccountId: "cash", isTransferIn: true,
    notes: "Unchanged leg note",
    date: "2026-01-10", name: "Transfer", amount: { amount: "100.00", currency: "USD" }, type: "transfer",
    isPending: false, isRecurring: false, isExcludedFromReports: false, isExcludedFromBudget: false, isPrivate: false,
    createdAt: "2026-01-10T10:00:00.000Z", updatedAt: "2026-01-10T10:00:00.000Z",
  };
  const newer = { ...original, amount: { amount: "125.00", currency: "USD" }, updatedAt: "2026-01-10T11:00:00.000Z" };
  const { result, rerender } = renderHook(useTransactionForm, { initialProps: { transaction: original, open: true } });
  act(() => result.current.form.setValue("amount", "40.00", { shouldDirty: true }));
  rerender({ transaction: { ...original }, open: true });
  expect(result.current.form.getValues("amount")).toBe("40.00");
  rerender({ transaction: newer, open: true });
  const submit = () => act(async () => { await result.current.onSubmit(result.current.form.getValues()); });
  await submit();
  expect(update).toHaveBeenLastCalledWith({ id: original.id, data: expect.objectContaining({
    fromAccountId: "cash", toAccountId: "savings", amount: { amount: "40.00", currency: "USD" }, expectedUpdatedAt: original.updatedAt,
  }) });
  expect(update.mock.lastCall?.[0].data).not.toHaveProperty("notes");
  expect(update.mock.lastCall?.[0].data).not.toHaveProperty("name");
  expect(update.mock.lastCall?.[0].data).not.toHaveProperty("date");
  rerender({ transaction: newer, open: false });
  rerender({ transaction: newer, open: true });
  act(() => {
    result.current.form.setValue("notes", "");
    result.current.form.setValue("merchantName", "Renamed transfer");
    result.current.form.setValue("date", new Date(2026, 0, 13));
  });
  await submit();
  expect(update).toHaveBeenLastCalledWith({ id: original.id, data: expect.objectContaining({
    amount: { amount: "125.00", currency: "USD" }, notes: null, name: "Renamed Transfer", date: "2026-01-13", expectedUpdatedAt: newer.updatedAt,
  }) });
  rerender({ transaction: newer, open: false });
  rerender({ transaction: { ...newer, amount: { amount: "2500.00", currency: "ZMW" } }, open: true });
  expect(result.current.form.getValues("amount")).toBe("");
});
