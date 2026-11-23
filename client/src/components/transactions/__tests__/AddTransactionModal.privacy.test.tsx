import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UseFormReturn } from "react-hook-form";
import type { Transaction } from "@/lib/api";
import type { TransactionFormValues } from "../form/schema";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { toast } from "sonner";
import { AddTransactionModal } from "../AddTransactionModal";

const mocks = vi.hoisted(() => ({ actor: "11111111-1111-4111-8111-111111111111", peer: "22222222-2222-4222-8222-222222222222",
  create: vi.fn(), update: vi.fn(), recurring: vi.fn(), transfer: vi.fn(), tagsWrite: vi.fn(), tagsAdd: vi.fn(), tags: [] as Array<{ id: string }> | undefined, tagsStatus: "success", prefs: {}, empty: [],
  files: [] as File[], uploadAll: vi.fn(), receiptId: null as string | null, receiptLink: vi.fn(),
  accounts: [{ id: "33333333-3333-4333-8333-333333333333", name: "Shared cash", currency: "ZMW", isPrivate: false }] }));
const mutation = (mutateAsync = vi.fn()) => ({ mutateAsync, mutate: vi.fn(), isPending: false });
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: mocks.accounts, isLoading: false }) }));
vi.mock("@/hooks/useGoals", () => ({ useGoals: () => ({ data: mocks.empty }), useTransactionGoalLinks: () => ({ data: mocks.empty }),
  useLinkTransaction: () => mutation(), useUnlinkTransactionFromGoal: () => mutation() }));
vi.mock("@/hooks/useCategories", () => ({ useCategories: () => ({ data: { categories: mocks.empty }, isLoading: false }) }));
vi.mock("@/hooks/use-settings", () => ({ useCreateMerchant: () => mutation(), useUpdateMerchant: () => mutation(),
  useUserPreferences: () => ({ data: mocks.prefs }), useProfile: () => ({ data: { id: mocks.actor } }) }));
vi.mock("@/contexts/SettingsContext", () => ({ useSettings: () => ({ currency: "ZMW" }) }));
vi.mock("@/hooks/useTransactions", () => ({ useCreateTransaction: () => mutation(mocks.create), useUpdateTransaction: () => mutation(mocks.update),
  useCreateTransfer: () => mutation(mocks.transfer), useUpdateTransfer: () => mutation(mocks.transfer), useDeleteTransaction: () => mutation() }));
vi.mock("@/hooks/useRecurring", () => ({ useCreateRecurringTransaction: () => mutation(mocks.recurring) }));
vi.mock("@/hooks", () => ({ useTransactionTags: () => ({ data: mocks.tags, isSuccess: mocks.tagsStatus === "success", isError: mocks.tagsStatus === "error" }), useSetTransactionTags: () => mutation(mocks.tagsWrite), useAddTagsToTransaction: () => mutation(mocks.tagsAdd) }));
vi.mock("@/hooks/useTransactionReceipt", () => ({ useTransactionReceipt: () => ({ scanModalOpen: false, linkedReceiptId: mocks.receiptId, isOcrProcessing: false,
  setScanModalOpen: vi.fn(), handleReceiptUploadSuccess: vi.fn(), clearReceipt: vi.fn(), linkReceiptToTransaction: (transactionId: string) => mocks.receiptLink({ receiptId: mocks.receiptId, transactionId }),
  captureReceiptLink: () => { const receiptId = mocks.receiptId; return receiptId ? (transactionId: string) => mocks.receiptLink({ receiptId, transactionId }) : undefined; } }) }));
vi.mock("@/hooks/useTransactionAttachments", () => ({ useTransactionAttachments: () => { const files = mocks.files; return { attachments: files, isUploading: false,
  fileInputRef: { current: null }, handleFileSelect: vi.fn(), removeAttachment: vi.fn(), clearAttachments: vi.fn(), uploadAll: (transactionId: string) => mocks.uploadAll({ files, transactionId }) }; } }));
vi.mock("@/components/receipts/ReceiptScanModal", () => ({ ReceiptScanModal: () => null }));
vi.mock("@/components/transactions/AttachmentsSection", () => ({ AttachmentsSection: () => null }));
vi.mock("@/components/transactions/form/GoalLinkingSection", () => ({ GoalLinkingSection: () => null }));
vi.mock("@/components/tags", () => ({ TagsMultiSelect: ({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) => <>
  <output data-testid="form-tags">{value.join(",")}</output><button type="button" onClick={() => onChange([])}>Clear selected tags</button>
</> }));
// Keep the real modal, hook, validation and privacy field. Unrelated widgets
// become stable controls over the same form and preserve its owner selection.
vi.mock("@/components/transactions/form/TransactionFormFields", () => ({ TransactionFormFields: ({ form }: { form: UseFormReturn<TransactionFormValues> }) => <>
  <label>Owner<select value={form.watch("ownerUserId") ?? "shared"} onChange={event => form.setValue("ownerUserId", event.target.value === "shared" ? null : event.target.value, { shouldDirty: true })}>
    <option value="shared">Shared</option><option value={mocks.actor}>Me</option><option value={mocks.peer}>Peer</option>
  </select></label><label>Merchant<input {...form.register("merchantName")} /></label><label>Amount<input {...form.register("amount")} /></label><label>Notes<textarea {...form.register("notes")} /></label>
</> }));
vi.mock("@/components/transactions/form/RecurringSettingsSection", () => ({ RecurringSettingsSection: ({ form }: { form: UseFormReturn<TransactionFormValues> }) =>
  <label>Recurring<input type="checkbox" checked={form.watch("isRecurring")} onChange={event => {
    form.setValue("isRecurring", event.target.checked); form.setValue("recurringFrequency", "monthly");
  }} /></label> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const initial: Partial<TransactionFormValues> = { type: "expense", accountId: mocks.accounts[0].id, amount: "12.35",
  merchantName: "Orchard", date: new Date("2026-02-12T12:00:00Z"), ownerUserId: mocks.actor };
const existing: Transaction = { id: "44444444-4444-4444-8444-444444444444", householdId: "55555555-5555-4555-8555-555555555555", accountId: mocks.accounts[0].id,
  ownerUserId: mocks.actor, date: "2026-02-12", name: "Orchard", amount: { amount: "12.35", currency: "ZMW" }, type: "expense", isPrivate: true,
  isPending: false, isRecurring: false, isExcludedFromBudget: false, isExcludedFromReports: false, createdAt: "2026-02-12T12:00:00Z", updatedAt: "2026-02-12T12:00:00Z" };
let expectations = { subject: mocks.actor, household: existing.householdId };
beforeEach(() => { vi.clearAllMocks(); mocks.tagsWrite.mockReset(); mocks.tagsAdd.mockReset(); vi.stubGlobal("crypto", webcrypto); localStorage.clear(); expectations = { subject: mocks.actor, household: crypto.randomUUID() }; activateOperationLifetime(createOperationLifetime(expectations)); mocks.prefs = {}; mocks.tags = []; mocks.tagsStatus = "success"; mocks.files = []; mocks.receiptId = null; mocks.uploadAll.mockResolvedValue(undefined); mocks.receiptLink.mockResolvedValue(undefined); mocks.accounts.splice(0, mocks.accounts.length, { id: initial.accountId!, name: "Shared cash", currency: "ZMW", isPrivate: false }); mocks.tagsWrite.mockResolvedValue({}); mocks.tagsAdd.mockResolvedValue({}); mocks.create.mockResolvedValue({ transaction: { id: existing.id }, isDuplicate: false }); mocks.update.mockResolvedValue(existing); });
afterEach(() => { cleanup(); retireOperationLifetime(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("submits a separate explicit private flag without changing the selected owner", async () => {
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  const privacy = screen.getByRole("checkbox", { name: "Private transaction" }); expect(privacy).not.toBeChecked();
  await userEvent.click(privacy); expect(screen.getByLabelText("Owner")).toHaveValue(mocks.actor);
  await userEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ isPrivate: true, ownerUserId: mocks.actor, accountId: mocks.accounts[0].id });
});
it("preserves an existing private flag on edit and sends an explicit publication choice", async () => {
  const view = render(<AddTransactionModal open onOpenChange={vi.fn()} transaction={existing} />);
  expect(screen.getByRole("checkbox", { name: "Private transaction" })).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce()); expect(mocks.update.mock.calls[0][0].data).toMatchObject({ isPrivate: true, ownerUserId: mocks.actor });
  view.unmount(); mocks.update.mockClear(); render(<AddTransactionModal open onOpenChange={vi.fn()} transaction={existing} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Private transaction" })); fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "shared" } });
  await userEvent.click(screen.getByRole("button", { name: "Save Changes" })); await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.update.mock.calls[0][0].data).toMatchObject({ isPrivate: false, ownerUserId: null });
});
it.each(["shared", "peer"] as const)("does not coerce %s attribution into the actor when Private is selected", async owner => {
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  fireEvent.change(screen.getByLabelText("Owner"), { target: { value: owner === "peer" ? mocks.peer : "shared" } });
  await userEvent.click(screen.getByRole("checkbox", { name: "Private transaction" })); await userEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  expect(await screen.findByText(/Choose yourself for a private transaction/i)).toBeVisible(); expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Owner")).toHaveValue(owner === "peer" ? mocks.peer : "shared");
});
it("does not silently drop selected private intent when a new recurring producer is selected", async () => {
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Private transaction" })); await userEvent.click(screen.getByRole("checkbox", { name: "Recurring" }));
  await userEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  expect(await screen.findByText(/Private.*recurring/i)).toBeVisible(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.recurring).not.toHaveBeenCalled();
  expect(screen.getByRole("checkbox", { name: "Private transaction" })).toBeChecked();
});
it("keeps ordinary public Shared attribution explicit", async () => {
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={{ ...initial, ownerUserId: null }} />);
  expect(screen.getByRole("checkbox", { name: "Private transaction" })).not.toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Add Transaction" })); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ isPrivate: false, ownerUserId: null });
});
it("keeps dirty privacy, owner and captured version across tags, preferences and the same record refreshing", async () => {
  const view = render(<AddTransactionModal open onOpenChange={vi.fn()} transaction={existing} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Private transaction" }));
  fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "shared" } });
  fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "Unsubmitted Orchard" } });
  mocks.prefs = { rememberLastAccount: true }; mocks.tags = [{ id: "66666666-6666-4666-8666-666666666666" }];
  view.rerender(<AddTransactionModal open onOpenChange={vi.fn()} transaction={{ ...existing, ownerUserId: mocks.peer, updatedAt: "2026-02-13T12:00:00Z" }} />);
  expect(screen.getByRole("checkbox", { name: "Private transaction" })).not.toBeChecked();
  expect(screen.getByLabelText("Owner")).toHaveValue("shared"); expect(screen.getByLabelText("Merchant")).toHaveValue("Unsubmitted Orchard");
  expect(screen.getByTestId("form-tags")).toHaveTextContent(mocks.tags[0].id);
  await userEvent.click(screen.getByRole("button", { name: "Save Changes" })); await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.update.mock.calls[0][0].data).toMatchObject({ isPrivate: false, ownerUserId: null, updatedAt: existing.updatedAt });
  expect(mocks.tagsWrite).not.toHaveBeenCalled();
});
it.each(["pending", "error", "success"])("keeps existing tags on a privacy-only save with a %s tag read", async status => {
  mocks.tagsStatus = status; mocks.tags = status === "success" ? [{ id: "existing-tag" }] : undefined;
  render(<AddTransactionModal open onOpenChange={vi.fn()} transaction={existing} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Private transaction" }));
  await userEvent.click(screen.getByRole("button", { name: "Save Changes" })); await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.tagsWrite).not.toHaveBeenCalled();
});
it("keeps existing tags on an attribution-only save", async () => {
  mocks.tags = [{ id: "existing-tag" }]; render(<AddTransactionModal open onOpenChange={vi.fn()} transaction={{ ...existing, isPrivate: false }} />);
  fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "shared" } });
  await userEvent.click(screen.getByRole("button", { name: "Save Changes" })); await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.tagsWrite).not.toHaveBeenCalled();
});
it("permits explicit clearing only after the existing tags have hydrated", async () => {
  mocks.tagsStatus = "pending"; mocks.tags = undefined;
  const view = render(<AddTransactionModal open onOpenChange={vi.fn()} transaction={existing} />);
  expect(screen.queryByRole("button", { name: "Clear selected tags" })).not.toBeInTheDocument();
  mocks.tagsStatus = "success"; mocks.tags = [{ id: "existing-tag" }]; view.rerender(<AddTransactionModal open onOpenChange={vi.fn()} transaction={existing} />);
  expect(screen.getByTestId("form-tags")).toHaveTextContent("existing-tag");
  await userEvent.click(screen.getByRole("button", { name: "Clear selected tags" }));
  await userEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(mocks.tagsWrite).toHaveBeenCalledWith({ transactionId: existing.id, tagIds: [] }));
});
it.each([undefined, "Property Rentals"])("omits untouched name and merchant when merchant display is %s", async merchantName => {
  render(<AddTransactionModal open onOpenChange={vi.fn()} transaction={{ ...existing, name: "Rent payment 42", merchantName, merchantId: merchantName ? "77777777-7777-4777-8777-777777777777" : undefined }} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Private transaction" }));
  await userEvent.click(screen.getByRole("button", { name: "Save Changes" })); await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.update.mock.calls[0][0].data).toMatchObject({ isPrivate: false });
  expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("name"); expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("merchantId");
});
it("still sends an intentional merchant/name change", async () => {
  render(<AddTransactionModal open onOpenChange={vi.fn()} transaction={existing} />);
  fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "New Orchard" } });
  await userEvent.click(screen.getByRole("button", { name: "Save Changes" })); await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.update.mock.calls[0][0].data).toMatchObject({ name: "New Orchard", merchantId: null });
});
it.each([null, "Existing retained receipt detail"])("omits untouched notes on a privacy-only save with notes %s", async notes => {
  render(<AddTransactionModal open onOpenChange={vi.fn()} transaction={{ ...existing, notes: notes ?? undefined }} />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Private transaction" }));
  await userEvent.click(screen.getByRole("button", { name: "Save Changes" })); await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty("notes");
});
it("still sends an explicit notes clear", async () => {
  render(<AddTransactionModal open onOpenChange={vi.fn()} transaction={{ ...existing, notes: "Existing annotation" }} />);
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "" } });
  await userEvent.click(screen.getByRole("button", { name: "Save Changes" })); await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.update.mock.calls[0][0].data).toMatchObject({ notes: null });
});
const submitOrdinary = () => userEvent.click(screen.getByRole("button", { name: /^(Add Transaction|Retry original transaction|Retry entered details)$/ }));
function loseCreateResponse(message: string) {
  globalThis.expectConsoleMessage?.("error", `Failed to save transaction: Error: ${message}`);
  mocks.create.mockRejectedValueOnce(new Error(message));
}
it.each(["same form", "remounted form"])("retries an unresolved ordinary submission with its original exact key and payload in the %s", async mode => {
  loseCreateResponse("Synthetic committed response lost");
  const view = render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  const original = structuredClone(mocks.create.mock.calls[0][0]);
  if (mode === "remounted form") { view.unmount(); render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />); }
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(mocks.create.mock.calls[1][0]).toEqual(original);
});
it("does not silently replace unresolved financial intent and preserves an explicit new entry", async () => {
  loseCreateResponse("Synthetic response lost");
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  const originalKey = mocks.create.mock.calls[0][0].idempotencyKey;
  fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "Another Orchard" } });
  globalThis.expectConsoleMessage?.("error", "Failed to save transaction: Error: An earlier submission is unresolved. Retry its original details, or start another transaction.");
  fireEvent.submit(screen.getByLabelText("Merchant").closest("form")!);
  await waitFor(() => expect(screen.getByText(/earlier submission is unresolved/i)).toBeVisible()); expect(mocks.create).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Start another transaction" }));
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(mocks.create.mock.calls[1][0]).toMatchObject({ name: "Another Orchard" }); expect(mocks.create.mock.calls[1][0].idempotencyKey).not.toBe(originalKey);
});
it("requires explicit new intent to post another identical entry after an unresolved response", async () => {
  loseCreateResponse("Synthetic response lost");
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  const original = structuredClone(mocks.create.mock.calls[0][0]);
  await userEvent.click(screen.getByRole("button", { name: "Start another transaction" })); await submitOrdinary();
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  const second = mocks.create.mock.calls[1][0]; expect(second).toEqual({ ...original, idempotencyKey: second.idempotencyKey }); expect(second.idempotencyKey).not.toBe(original.idempotencyKey);
});
it("keeps only the retry identity after same-subject reauthorization, without restoring old financial input", async () => {
  loseCreateResponse("Synthetic response lost");
  const view = render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce()); const original = structuredClone(mocks.create.mock.calls[0][0]);
  view.unmount(); retireOperationLifetime(); activateOperationLifetime(createOperationLifetime(expectations));
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={{ ...initial, merchantName: "", amount: "" }} />);
  expect(screen.getByLabelText("Merchant")).toHaveValue(""); expect(screen.getByLabelText("Amount")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: initial.merchantName } }); fireEvent.change(screen.getByLabelText("Amount"), { target: { value: initial.amount } });
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2)); expect(mocks.create.mock.calls[1][0]).toEqual(original);
});
it.each(["subject", "household"] as const)("separates unresolved create identity after a different verified %s", async field => {
  loseCreateResponse("Synthetic response lost");
  const view = render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce()); const originalKey = mocks.create.mock.calls[0][0].idempotencyKey;
  view.unmount(); retireOperationLifetime(); activateOperationLifetime(createOperationLifetime({ ...expectations, [field]: mocks.peer }));
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  expect(screen.queryByRole("button", { name: "Retry original transaction" })).not.toBeInTheDocument();
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2)); expect(mocks.create.mock.calls[1][0].idempotencyKey).not.toBe(originalKey);
});
it("claims an ordinary submit synchronously while digest preparation is deferred", async () => {
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  const actual = crypto.subtle.digest.bind(crypto.subtle);
  const digest = vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => { await blocked; return actual(...args); });
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  const form = screen.getByLabelText("Merchant").closest("form")!; fireEvent.submit(form);
  await waitFor(() => expect(digest).toHaveBeenCalledOnce()); fireEvent.submit(form);
  expect(mocks.create).not.toHaveBeenCalled(); release(); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
});
it.each(["tags", "receipt"] as const)("holds the same submission through a deferred %s effect", async effect => {
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  if (effect === "tags") mocks.tagsAdd.mockImplementationOnce(() => blocked); else { mocks.receiptId = "original-receipt"; mocks.receiptLink.mockImplementationOnce(() => blocked); }
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={{ ...initial, tags: effect === "tags" ? ["original-tag"] : [] }} />);
  await submitOrdinary(); await waitFor(() => expect(effect === "tags" ? mocks.tagsAdd : mocks.receiptLink).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Start another transaction" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Retry original transaction" })).toBeDisabled();
  fireEvent.submit(screen.getByLabelText("Merchant").closest("form")!); expect(mocks.create).toHaveBeenCalledOnce(); await act(async () => { release(); });
});
it("retries the captured USD request even when account data reloads under a ZMW display default", async () => {
  mocks.accounts[0].currency = "USD"; loseCreateResponse("Synthetic response lost");
  const view = render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce()); const original = structuredClone(mocks.create.mock.calls[0][0]);
  mocks.accounts.splice(0); view.rerender(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2)); expect(mocks.create.mock.calls[1][0]).toEqual(original);
  expect(original.amount.currency).toBe("USD");
});
it("keeps original staged files and receipt purpose through remount instead of attaching replacements to old cash", async () => {
  const first = new File(["first"], "original.pdf", { type: "application/pdf" }), second = new File(["second"], "replacement.pdf", { type: "application/pdf" });
  mocks.files = [first]; mocks.receiptId = "original-receipt"; loseCreateResponse("Synthetic response lost");
  const view = render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce()); view.unmount();
  mocks.files = [second]; mocks.receiptId = "replacement-receipt"; render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  await submitOrdinary(); await waitFor(() => expect(mocks.receiptLink).toHaveBeenCalledOnce());
  expect(mocks.uploadAll).toHaveBeenCalledExactlyOnceWith({ files: [first], transactionId: existing.id });
  expect(mocks.receiptLink).toHaveBeenCalledExactlyOnceWith({ receiptId: "original-receipt", transactionId: existing.id });
});
it("does not attach replacement follow-ups after the original session's files and receipt purpose are retired", async () => {
  mocks.files = [new File(["first"], "original.pdf", { type: "application/pdf" })]; mocks.receiptId = "original-receipt"; loseCreateResponse("Synthetic response lost");
  const view = render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce()); view.unmount(); retireOperationLifetime(); activateOperationLifetime(createOperationLifetime(expectations));
  mocks.files = [new File(["second"], "replacement.pdf", { type: "application/pdf" })]; mocks.receiptId = "replacement-receipt";
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={initial} />);
  expect(screen.getByText(/original follow-up selections are unavailable/i)).toBeVisible();
  await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2)); expect(mocks.uploadAll).not.toHaveBeenCalled(); expect(mocks.receiptLink).not.toHaveBeenCalled();
});
it("does not reset a replacement session's draft when an old receipt callback finishes", async () => {
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; }), onSuccess = vi.fn();
  mocks.receiptId = "old-receipt"; mocks.receiptLink.mockImplementationOnce(() => blocked);
  const view = render(<AddTransactionModal open onOpenChange={vi.fn()} onSuccess={onSuccess} initialValues={initial} />);
  await submitOrdinary(); await waitFor(() => expect(mocks.receiptLink).toHaveBeenCalledOnce());
  retireOperationLifetime(); activateOperationLifetime(createOperationLifetime({ subject: mocks.actor, household: mocks.peer }));
  view.rerender(<AddTransactionModal open={false} onOpenChange={vi.fn()} onSuccess={onSuccess} initialValues={initial} />);
  view.rerender(<AddTransactionModal open onOpenChange={vi.fn()} onSuccess={onSuccess} initialValues={{ ...initial, merchantName: "Replacement draft" }} />);
  await act(async () => { release(); }); expect(screen.getByLabelText("Merchant")).toHaveValue("Replacement draft"); expect(onSuccess).not.toHaveBeenCalled();
});
it("adds initial create tags without removing a peer tag after a lost tag acknowledgement", async () => {
  const linked = new Set<string>();
  const add = async ({ tagIds }: { tagIds: string[] }) => { tagIds.forEach(id => linked.add(id)); };
  const replace = async ({ tagIds }: { tagIds: string[] }) => { linked.clear(); tagIds.forEach(id => linked.add(id)); };
  mocks.tagsAdd.mockImplementation(add).mockImplementationOnce(async input => { await add(input); throw new Error("Synthetic tag acknowledgement lost"); });
  mocks.tagsWrite.mockImplementation(replace).mockImplementationOnce(async input => { await replace(input); throw new Error("Synthetic tag acknowledgement lost"); });
  globalThis.expectConsoleMessage?.("error", "Failed to save transaction: Error: Synthetic tag acknowledgement lost");
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={{ ...initial, tags: ["A"] }} />);
  await submitOrdinary(); await waitFor(() => expect(linked.has("A")).toBe(true));
  linked.add("B"); await submitOrdinary(); await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
  expect(Array.from(linked).sort()).toEqual(["A", "B"]); expect(mocks.tagsWrite).not.toHaveBeenCalled();
});
it("keeps a new private draft and its selected owner when preferences arrive", async () => {
  const seed = { ...initial, ownerUserId: null }, view = render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={seed} />);
  fireEvent.change(screen.getByLabelText("Owner"), { target: { value: mocks.actor } });
  await userEvent.click(screen.getByRole("checkbox", { name: "Private transaction" }));
  mocks.prefs = { rememberLastAccount: true }; view.rerender(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={seed} />);
  expect(screen.getByRole("checkbox", { name: "Private transaction" })).toBeChecked(); expect(screen.getByLabelText("Owner")).toHaveValue(mocks.actor);
  await userEvent.click(screen.getByRole("button", { name: "Add Transaction" })); await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ isPrivate: true, ownerUserId: mocks.actor });
});
it("alerts and does not save when the merchant is missing on an expense", async () => {
  render(<AddTransactionModal open onOpenChange={vi.fn()} initialValues={{ ...initial, merchantName: "" }} />);
  await userEvent.click(screen.getByRole("button", { name: "Add Transaction" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/not saved/i), expect.objectContaining({ description: expect.stringContaining("Merchant / Name") })));
  expect(mocks.create).not.toHaveBeenCalled();
});
