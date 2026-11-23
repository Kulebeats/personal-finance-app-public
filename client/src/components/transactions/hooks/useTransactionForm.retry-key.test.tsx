import { webcrypto } from "node:crypto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import type { TransactionFormValues } from "../form/schema";
import { useTransactionForm } from "./useTransactionForm";

// A-45 / A-46: the Add Transaction form must keep one operation key across an
// uncertain result (server committed, reply lost), and use a new key only for
// a deliberately new transaction after a confirmed success.
const createTransfer = vi.hoisted(() => vi.fn());
const createRecurring = vi.hoisted(() => vi.fn());
const setTags = vi.hoisted(() => vi.fn());
const selections = vi.hoisted(() => ({ files: [] as File[], receiptId: "", upload: vi.fn(), link: vi.fn() }));
vi.mock("@/hooks/useTransactions", () => ({
  useCreateTransaction: () => ({}), useUpdateTransaction: () => ({}), useDeleteTransaction: () => ({}),
  useCreateTransfer: () => ({ mutateAsync: createTransfer }), useUpdateTransfer: () => ({}),
}));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [{ id: "cash", currency: "ZMW" }, { id: "savings", currency: "ZMW" }] }) }));
vi.mock("@/hooks/useCategories", () => ({ useCategories: () => ({}) }));
vi.mock("@/hooks/useGoals", () => ({
  useGoals: () => ({}), useLinkTransaction: () => ({}), useTransactionGoalLinks: () => ({}),
  useUnlinkTransactionFromGoal: () => ({}),
}));
vi.mock("@/hooks/use-settings", () => ({
  useProfile: () => ({ data: { id: "actor" } }),
  useCreateMerchant: () => ({}), useUpdateMerchant: () => ({ mutate() {} }), useUserPreferences: () => ({}),
}));
vi.mock("@/hooks/useRecurring", () => ({ useCreateRecurringTransaction: () => ({ mutateAsync: createRecurring }) }));
vi.mock("@/hooks", () => ({
  useTransactionTags: () => ({}), useSetTransactionTags: () => ({ mutateAsync: setTags }), useAddTagsToTransaction: () => ({}),
}));
vi.mock("@/hooks/useTransactionReceipt", () => ({ useTransactionReceipt: () => ({
  captureReceiptLink: () => {
    const receiptId = selections.receiptId;
    return receiptId ? (transactionId: string) => selections.link({ transactionId, receiptId }) : undefined;
  },
}) }));
vi.mock("@/hooks/useTransactionAttachments", () => ({ useTransactionAttachments: () => {
  const files = selections.files;
  return { attachments: files, clearAttachments: () => { selections.files = []; },
    uploadAll: (transactionId: string) => selections.upload({ transactionId, names: files.map(file => file.name) }) };
} }));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ currency: "ZMW" }) }));

const lostReply = () => new TypeError("Failed to fetch");
const base = {
  amount: "250.00", merchantName: "Synthetic rent", date: new Date(2026, 10, 10), accountId: "cash",
  tags: [], ownerUserId: null, isPrivate: false,
};
const transferValues = { ...base, type: "transfer", toAccountId: "savings", isRecurring: false } as TransactionFormValues;
const recurringValues = {
  ...base, type: "expense", isRecurring: true, recurringFrequency: "monthly", recurringAmountType: "fixed",
  recurringAmountTolerance: 0, recurringReminderDays: 3, recurringReminderEmail: false, recurringReminderPush: false,
  recurringReminderInApp: true, recurringAutoLinkEnabled: true, recurringAutoMarkReviewed: false, recurringIsSubscription: false,
} as TransactionFormValues;

const paths = [
  { finding: "A-46 transfer", values: transferValues, mutate: createTransfer, ok: { outflow: { id: "out" }, inflow: { id: "in" }, isDuplicate: false } },
  { finding: "A-45 recurring", values: recurringValues, mutate: createRecurring, ok: { transaction: { id: "txn" }, recurringRule: { id: "rule" }, isDuplicate: false } },
];

function renderForm() {
  const view = renderHook(useTransactionForm, { initialProps: { open: true } });
  const { result } = view;
  const submit = (values: TransactionFormValues) => act(async () => { await result.current.onSubmit(values); });
  const retry = () => act(async () => { result.current.ordinaryRecovery.retry(); });
  return { ...view, submit, retry };
}
const keyOf = (call: unknown[] | undefined) => (call?.[0] as { idempotencyKey?: string } | undefined)?.idempotencyKey;

let subject: string;
const activate = (actor: string) => activateOperationLifetime(createOperationLifetime({ subject: actor, household: "household" }));
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  const stored = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    get length() { return stored.size; },
    key: (index: number) => Array.from(stored.keys())[index] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
    clear: () => { stored.clear(); },
  });
  subject = crypto.randomUUID();
  activate(subject);
  createTransfer.mockReset();
  createRecurring.mockReset();
  setTags.mockReset();
  selections.files = [];
  selections.receiptId = "";
  selections.upload.mockReset();
  selections.link.mockReset();
});
afterEach(() => { retireOperationLifetime(); sessionStorage.clear(); vi.unstubAllGlobals(); });

describe.each(paths)("$finding: Add Transaction retry keeps one operation key", ({ values, mutate, ok }) => {
  it("resends the same key and terms when the reply was lost, then a new identical transaction gets a new key", async () => {
    const { result, submit } = renderForm();
    mutate.mockRejectedValueOnce(lostReply()).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok);
    globalThis.expectConsoleMessage?.("error", "Failed to fetch");

    await submit(values);
    const pendingAfterLostReply = result.current.ordinaryRecovery.pending;
    await submit(values);
    await submit(values);

    expect(mutate).toHaveBeenCalledTimes(3);
    const [first, retry, another] = mutate.mock.calls.map(keyOf);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(retry).toBe(first);
    expect(mutate.mock.calls[1][0]).toEqual(mutate.mock.calls[0][0]);
    expect(another).toMatch(/^[0-9a-f-]{36}$/);
    expect(another).not.toBe(first);
    expect(pendingAfterLostReply).toBe(true);
    expect(result.current.ordinaryRecovery.pending).toBe(false);
  });

  it("refuses changed terms while the first result is unresolved, and Start another releases the key", async () => {
    const { result, submit } = renderForm();
    mutate.mockRejectedValueOnce(lostReply()).mockResolvedValueOnce(ok);
    globalThis.expectConsoleMessage?.("error", "Failed to fetch");
    globalThis.expectConsoleMessage?.("error", /earlier submission is unresolved/i);

    await submit(values);
    await submit({ ...values, amount: "999.00" });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(result.current.ordinaryRecovery.error).toMatch(/earlier submission is unresolved/i);

    act(() => result.current.ordinaryRecovery.startAnother());
    expect(result.current.ordinaryRecovery.error).toBeNull();
    expect(result.current.ordinaryRecovery.pending).toBe(false);
    await submit({ ...values, amount: "999.00" });
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(keyOf(mutate.mock.calls[1])).not.toBe(keyOf(mutate.mock.calls[0]));
  });

  it("releases the key after a definite server rejection so a corrected form posts as a new operation", async () => {
    const { submit } = renderForm();
    const rejected = Object.assign(new Error("Amount is invalid"), { status: 400 });
    mutate.mockRejectedValueOnce(rejected).mockResolvedValueOnce(ok);
    globalThis.expectConsoleMessage?.("error", "Amount is invalid");

    await submit(values);
    await submit({ ...values, amount: "200.00" });
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(keyOf(mutate.mock.calls[1])).not.toBe(keyOf(mutate.mock.calls[0]));
  });

  it("restores the original draft and request after closing or remounting the modal", async () => {
    const first = renderForm();
    mutate.mockRejectedValueOnce(lostReply()).mockResolvedValueOnce(ok);
    globalThis.expectConsoleMessage?.("error", "Failed to fetch");
    await first.submit(values);

    first.rerender({ open: false });
    first.rerender({ open: true });
    expect(first.result.current.ordinaryRecovery.canRetryOriginal).toBe(true);
    expect(first.result.current.form.getValues("amount")).toBe(values.amount);
    first.unmount();

    const reopened = renderForm();
    expect(reopened.result.current.ordinaryRecovery.pending).toBe(true);
    await reopened.retry();
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1][0]).toEqual(mutate.mock.calls[0][0]);
    expect(reopened.result.current.ordinaryRecovery.pending).toBe(false);
  });

  it("keeps only same-actor retry identity across reauthentication", async () => {
    const first = renderForm();
    mutate.mockRejectedValueOnce(lostReply()).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok);
    globalThis.expectConsoleMessage?.("error", "Failed to fetch");
    await first.submit(values);
    const retained = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
    expect(retained).toEqual({ key: keyOf(mutate.mock.calls[0]), fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    first.unmount();

    activate("different-actor");
    const different = renderForm();
    expect(different.result.current.ordinaryRecovery.pending).toBe(false);
    expect(different.result.current.form.getValues("merchantName")).not.toBe(values.merchantName);
    await different.submit(values);
    different.unmount();

    activate(subject);
    const same = renderForm();
    expect(same.result.current.ordinaryRecovery.pending).toBe(true);
    expect(same.result.current.ordinaryRecovery.canRetryOriginal).toBe(false);
    expect(same.result.current.form.getValues("merchantName")).not.toBe(values.merchantName);
    await same.submit(values);
    expect(mutate).toHaveBeenCalledTimes(3);
    expect(keyOf(mutate.mock.calls[1])).not.toBe(keyOf(mutate.mock.calls[0]));
    expect(mutate.mock.calls[2][0]).toEqual(mutate.mock.calls[0][0]);
  });
});

it("retries failed tags for the confirmed recurring transaction without another create", async () => {
  selections.files = [new File(["synthetic"], "original.pdf")];
  selections.receiptId = "original-receipt";
  const first = renderForm();
  createRecurring.mockResolvedValueOnce(paths[1].ok);
  setTags.mockRejectedValueOnce(new Error("Tags did not save")).mockResolvedValueOnce(undefined);
  globalThis.expectConsoleMessage?.("error", "Tags did not save");

  await first.submit({ ...recurringValues, tags: ["original-tag"] });
  expect(first.result.current.ordinaryRecovery.pending).toBe(true);
  first.unmount();
  selections.files = [new File(["synthetic"], "replacement.pdf")];
  selections.receiptId = "replacement-receipt";
  const reopened = renderForm();
  await reopened.retry();

  expect(createRecurring).toHaveBeenCalledTimes(1);
  expect(setTags.mock.calls).toEqual([
    [{ transactionId: "txn", tagIds: ["original-tag"] }],
    [{ transactionId: "txn", tagIds: ["original-tag"] }],
  ]);
  expect(selections.upload.mock.calls).toEqual([[{ transactionId: "txn", names: ["original.pdf"] }]]);
  expect(selections.link.mock.calls).toEqual([[{ transactionId: "txn", receiptId: "original-receipt" }]]);
  expect(reopened.result.current.ordinaryRecovery.pending).toBe(false);
});

it("blocks a second modal during a request and uses the late acknowledgement after the first modal unmounts", async () => {
  const first = renderForm();
  const receipt = Promise.withResolvers<typeof paths[1]["ok"]>();
  createRecurring.mockReturnValueOnce(receipt.promise);
  let inFlight!: Promise<void>;
  act(() => { inFlight = first.result.current.onSubmit({ ...recurringValues, tags: ["original-tag"] }); });
  await waitFor(() => expect(createRecurring).toHaveBeenCalledOnce());
  first.unmount();

  const reopened = renderForm();
  await reopened.retry();
  expect(reopened.result.current.ordinaryRecovery.error).toMatch(/already in progress/i);
  expect(createRecurring).toHaveBeenCalledOnce();
  expect(setTags).not.toHaveBeenCalled();
  await act(async () => { receipt.resolve(paths[1].ok); await inFlight; });
  await reopened.retry();

  expect(createRecurring).toHaveBeenCalledOnce();
  expect(setTags.mock.calls).toEqual([[{ transactionId: "txn", tagIds: ["original-tag"] }]]);
  expect(reopened.result.current.ordinaryRecovery.pending).toBe(false);
});

it("does not run an old actor's follow-ups after a late acknowledgement", async () => {
  const first = renderForm();
  const receipt = Promise.withResolvers<typeof paths[1]["ok"]>();
  createRecurring.mockReturnValueOnce(receipt.promise);
  let inFlight!: Promise<void>;
  act(() => { inFlight = first.result.current.onSubmit({ ...recurringValues, tags: ["old-actor-tag"] }); });
  await waitFor(() => expect(createRecurring).toHaveBeenCalledOnce());
  first.unmount();

  activate("new-actor");
  const different = renderForm();
  await act(async () => { receipt.resolve(paths[1].ok); await inFlight; });
  expect(different.result.current.ordinaryRecovery.pending).toBe(false);
  expect(setTags).not.toHaveBeenCalled();
  expect(createRecurring).toHaveBeenCalledOnce();
});
