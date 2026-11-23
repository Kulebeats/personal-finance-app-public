import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { GrzBond } from "@/hooks/useGrzSecurities";
import { BondScheduleDialog } from "../BondScheduleDialog";

const calls = vi.hoisted(() => ({ post: vi.fn(), coupon: vi.fn(), toast: vi.fn() }));
const session = vi.hoisted(() => ({ role: "owner", operation: { id: 1, active: true } }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ status: { state: "ready", household: { role: session.role } },
  lifetime: { operation: session.operation } }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: calls.post }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: calls.toast }) }));
vi.mock("@/hooks/use-format", () => ({ useFormat: () => ({ formatCurrency: (n: number) => String(n) }) }));
vi.mock("@/hooks/useGrzSecurities", () => ({ grzKeys: { bonds: () => ["grz", "bonds"] },
  useMarkGrzPaymentPaid: () => ({ mutateAsync: calls.coupon }) }));
vi.mock("@/hooks/useAccounts", () => ({ accountKeys: { all: ["accounts"] }, useAccounts: () => ({
  data: [{ id: "cash", name: "Cash account", currency: "ZMW" }, { id: "usd", name: "USD cash", currency: "USD" }],
}) }));
vi.mock("@/hooks/useTransactions", () => ({ transactionKeys: { all: ["transactions"] }, useTransactions: () => ({
  data: { transactions: [{ id: "30be70e2-7682-49c1-8bac-8de14aa06e84", name: "Custody bank receipt", date: "2026-02-04", accountId: "cash",
    type: "income", amount: { amount: "990.00", currency: "ZMW" } }], pagination: { hasNext: false } }, isSuccess: true,
}) }));
vi.mock("@/hooks/use-reports", () => ({ invalidateReportsForChange: vi.fn() }));
const payment = { id: "principal", paymentDate: "2026-02-04", paymentType: "principal", grossAmount: { amount: "1000.00", currency: "ZMW" },
  withholdingTax: { amount: "0.00", currency: "ZMW" }, netAmount: { amount: "1000.00", currency: "ZMW" }, status: "scheduled", actualPaymentDate: null } as const;
const bond: GrzBond = { id: "bond", accountId: "cash", bondName: "Mature issue", isin: "ZM0000000001", tenorYears: 2,
  faceValue: { amount: "1000.00", currency: "ZMW" }, purchasePrice: { amount: "950.00", currency: "ZMW" }, purchaseDate: "2024-02-04", purchaseYield: null, couponRate: "0.1",
  couponFrequency: 2, maturityDate: payment.paymentDate, status: "active", createdAt: "2024-02-04", payments: [payment] };
beforeEach(() => { vi.resetAllMocks(); session.operation = { id: session.operation.id + 1, active: true }; session.role = "owner"; });
function showSchedule() {
  render(<QueryClientProvider client={new QueryClient()}><BondScheduleDialog bond={bond} open onOpenChange={vi.fn()} /></QueryClientProvider>);
}
async function openForm(mode: "existing" | "new") {
  const user = userEvent.setup();
  showSchedule();
  await user.click(screen.getByRole("button", { name: "Record principal" }));
  await fillForm(user, mode);
  return user;
}
async function fillForm(user: ReturnType<typeof userEvent.setup>, mode: "existing" | "new") {
  expect(screen.queryByRole("button", { name: "Confirm Income" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "USD cash" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Receiving account"), "cash");
  fireEvent.change(screen.getByLabelText("Receipt date"), { target: { value: payment.paymentDate } });
  await user.type(screen.getByLabelText("Cash received (ZMW)"), "990.00");
  await user.clear(screen.getByLabelText("Redemption fees (ZMW)"));
  await user.type(screen.getByLabelText("Redemption fees (ZMW)"), "10.00");
  await user.selectOptions(screen.getByLabelText("Cash entry"), mode);
}

it("retains the same operation for an uncertain response and a pending retry, without reporting coupon income", async () => {
  calls.post.mockRejectedValueOnce(new Error("Connection interrupted"))
    .mockImplementation(async (_method, _path, body) => ({ status: 202, json: async () => ({ data: { id: payment.id, status: "scheduled", settlement: {
      operationId: body.operationId, status: "pending", pendingReason: "basis_unavailable", cashTransactionId: null } } }) }));
  const user = await openForm("new");
  const confirm = screen.getByRole("button", { name: "Confirm principal repayment" });
  await user.click(confirm); expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
  await user.click(screen.getByRole("button", { name: "Retry original receipt" })); expect(await screen.findByText(/Record the purchase breakdown/)).toBeVisible();
  const first = calls.post.mock.calls[0];
  expect(first).toEqual(["POST", "/api/grz/payments/principal/pay", { operationId: expect.any(String), accountId: "cash",
    date: payment.paymentDate, receiptConfirmed: true, receivedAmount: { amount: "990.00", currency: "ZMW" }, fees: { amount: "10.00", currency: "ZMW" } }, session.operation]);
  expect(calls.post.mock.calls[1]).toEqual(first); expect(calls.coupon).not.toHaveBeenCalled(); expect(calls.toast).not.toHaveBeenCalled();
});

it("links an explicitly selected receipt and reports confirmation only after the server confirms", async () => {
  calls.post.mockImplementation(async (_method, _path, body) => ({ status: 200, json: async () => ({ data: { id: payment.id, status: "paid", settlement: {
    operationId: body.operationId, status: "confirmed", pendingReason: null, cashTransactionId: "30be70e2-7682-49c1-8bac-8de14aa06e84" } } }) }));
  const user = await openForm("existing");
  await user.selectOptions(screen.getByLabelText("Matching income receipt"), "30be70e2-7682-49c1-8bac-8de14aa06e84");
  await user.click(screen.getByRole("button", { name: "Confirm principal repayment" }));
  await waitFor(() => expect(calls.toast).toHaveBeenCalledWith({ title: "Principal repayment recorded" }));
  expect(calls.post.mock.calls[0][2]).toMatchObject({ receiptTransactionId: "30be70e2-7682-49c1-8bac-8de14aa06e84" });
  expect(calls.coupon).not.toHaveBeenCalled();
});

it.each(["existing", "new"] as const)("recovers the original %s request after remounting a now-paid schedule", async mode => {
  calls.post.mockRejectedValueOnce(new Error("Response lost")).mockImplementationOnce(async (_method, _path, body) => ({
    status: 200, json: async () => ({ data: { id: payment.id, status: "paid", settlement: { operationId: body.operationId,
      status: "confirmed", pendingReason: null, cashTransactionId: "30be70e2-7682-49c1-8bac-8de14aa06e84" } } }),
  }));
  const user = await openForm(mode);
  if (mode === "existing") await user.selectOptions(screen.getByLabelText("Matching income receipt"), "30be70e2-7682-49c1-8bac-8de14aa06e84");
  await user.click(screen.getByRole("button", { name: "Confirm principal repayment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Response lost");
  cleanup();
  const settled: GrzBond = { ...bond, status: "matured", payments: [{ ...payment, status: "paid" }] };
  render(<QueryClientProvider client={new QueryClient()}><BondScheduleDialog bond={settled} open onOpenChange={vi.fn()} /></QueryClientProvider>);
  await user.click(screen.getByRole("button", { name: "Review principal receipt" }));
  await user.click(screen.getByRole("button", { name: "Retry original receipt" }));
  await waitFor(() => expect(calls.toast).toHaveBeenCalledOnce());
  expect(calls.post.mock.calls[1]).toEqual(calls.post.mock.calls[0]);
});

it("keeps an unverifiable confirmation in doubt and excludes it from the next identity", async () => {
  calls.post.mockImplementationOnce(async (_method, _path, body) => ({ status: 202, json: async () => ({
    data: { id: payment.id, status: "paid", settlement: { operationId: body.operationId, status: "confirmed", pendingReason: null } },
  }) }));
  const user = await openForm("new");
  await user.click(screen.getByRole("button", { name: "Confirm principal repayment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be verified"); expect(calls.toast).not.toHaveBeenCalled();
  cleanup(); session.operation.active = false; session.operation = { id: session.operation.id + 1, active: true }; session.role = "professional";
  render(<QueryClientProvider client={new QueryClient()}><BondScheduleDialog bond={bond} open onOpenChange={vi.fn()} /></QueryClientProvider>);
  expect(screen.queryByRole("button", { name: /principal/i })).not.toBeInTheDocument();
});

it("distinguishes a delayed receipt date from the missing maturity valuation", async () => {
  calls.post.mockImplementationOnce(async (_method, _path, body) => ({ status: 202, json: async () => ({
    data: { id: payment.id, status: "scheduled", settlement: { operationId: body.operationId, status: "pending",
      pendingReason: "valuation_unavailable", cashTransactionId: null } },
  }) }));
  const user = await openForm("new");
  fireEvent.change(screen.getByLabelText("Receipt date"), { target: { value: "2026-02-06" } });
  await user.click(screen.getByRole("button", { name: "Confirm principal repayment" }));
  expect(await screen.findByText(/contractual maturity date/)).toHaveTextContent(payment.paymentDate);
  expect(calls.post.mock.calls[0][2].date).toBe("2026-02-06");
});

it("keeps a pending coupon separate and rejects confirmation linked to a different transaction", async () => {
  calls.post.mockImplementationOnce(async (_method, _path, body) => ({ status: 202, json: async () => ({
    data: { id: payment.id, status: "scheduled", settlement: { operationId: body.operationId, status: "pending",
      pendingReason: "coupon_component_unresolved", cashTransactionId: null } },
  }) })).mockImplementationOnce(async (_method, _path, body) => ({ status: 200, json: async () => ({
    data: { id: payment.id, status: "paid", settlement: { operationId: body.operationId, status: "confirmed",
      pendingReason: null, cashTransactionId: "b8135e88-e156-4906-b514-431cb59108cd" } },
  }) }));
  const user = await openForm("existing");
  await user.selectOptions(screen.getByLabelText("Matching income receipt"), "30be70e2-7682-49c1-8bac-8de14aa06e84");
  await user.click(screen.getByRole("button", { name: "Confirm principal repayment" }));
  expect(await screen.findByText(/Reconcile the coupon schedule and any separate cash receipt/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Retry original receipt" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be verified"); expect(calls.toast).not.toHaveBeenCalled();
});

it("keeps a replacement receipt locked when an older submission returns late", async () => {
  const pending = (operationId: string) => ({ status: 202, json: async () => ({ data: {
    id: payment.id, status: "scheduled", settlement: { operationId, status: "pending", pendingReason: "basis_unavailable", cashTransactionId: null },
  } }) });
  let release!: () => void;
  calls.post.mockImplementationOnce((_method, _path, body) => new Promise(resolve => {
    release = () => resolve(pending(body.operationId));
  })).mockImplementationOnce(async (_method, _path, body) => pending(body.operationId))
    .mockRejectedValueOnce(new Error("Replacement response lost"));
  const user = await openForm("new");
  await user.click(screen.getByRole("button", { name: "Confirm principal repayment" }));
  cleanup(); showSchedule();
  await user.click(screen.getByRole("button", { name: "Review principal receipt" }));
  await user.click(screen.getByRole("button", { name: "Retry original receipt" }));
  await user.click(await screen.findByRole("button", { name: "Review new terms" }));
  await fillForm(user, "new"); await user.click(screen.getByRole("button", { name: "Confirm principal repayment" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Replacement response lost");
  expect(calls.post.mock.calls[2][2].operationId).not.toBe(calls.post.mock.calls[0][2].operationId);
  await act(async () => release()); cleanup(); showSchedule();
  await user.click(screen.getByRole("button", { name: "Review principal receipt" }));
  expect(screen.getByRole("button", { name: "Retry original receipt" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Review new terms" })).not.toBeInTheDocument();
});
