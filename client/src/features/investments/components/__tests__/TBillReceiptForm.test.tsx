import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GrzTBill } from "@/hooks/useGrzSecurities";
import { createOperationLifetime } from "@/lib/operation-lifetime";
import { setHouseholdCalendarTimeZone } from "@/lib/calendarZone";
import { TBillReceiptAction } from "../TBillReceiptForm";

const lifetime = createOperationLifetime({ subject: "actor-a", household: "home-a" });
const mocks = vi.hoisted(() => ({ request: vi.fn(), role: "member" }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", household: { role: mocks.role } }, lifetime: { operation: lifetime } }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.request }));
vi.mock("@/lib/api", () => ({ generateIdempotencyKey: () => "op-1" }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-reports", () => ({ invalidateReportsForChange: vi.fn() }));
vi.mock("@/hooks/useTransactions", () => ({ transactionKeys: { all: ["transactions"] } }));
vi.mock("@/hooks/investments/keys", () => ({ investmentKeys: { transactionsRoot: () => ["investment-transactions"] } }));
vi.mock("@/hooks/useGrzSecurities", () => ({ grzKeys: { tbills: () => ["grz", "tbills"] } }));
vi.mock("@/hooks/useAccounts", () => ({ accountKeys: { all: ["accounts"] }, useAccounts: () => ({ data: [
  { id: "zmw", name: "Kwacha cash", currency: "ZMW", isAsset: true, isArchived: false },
  { id: "usd", name: "Dollar cash", currency: "USD", isAsset: true, isArchived: false },
] }) }));

const bill: GrzTBill = { id: "bill", accountId: "zmw", tbillName: "Due bill", isin: null, tenorDays: 364,
  faceValue: { amount: "10000.00", currency: "ZMW" }, purchasePrice: { amount: "8000.00", currency: "ZMW" },
  purchaseDate: "2025-10-01", purchaseYield: null, discountAmount: { amount: "2000.00", currency: "ZMW" }, maturityDate: "2026-10-01",
  status: "awaiting_receipt", createdAt: "2025-10-01", maturityWithholdingTax: { amount: "300.00", currency: "ZMW" },
  maturityNetProceeds: { amount: "9700.00", currency: "ZMW" } };
const renderAction = (tbill: GrzTBill = bill) => render(
  <QueryClientProvider client={new QueryClient()}><TBillReceiptAction tbill={tbill} /></QueryClientProvider>);

beforeEach(() => { vi.clearAllMocks(); mocks.role = "member"; });
afterEach(async () => { cleanup(); vi.useRealTimers(); setHouseholdCalendarTimeZone(null); await Promise.resolve(); });

it("R1-04: lets a Lusaka member pick today's household date just after local midnight", async () => {
  // 23:30 UTC on 21 November is 01:30 on 22 November in Lusaka (UTC+2).
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-21T23:30:00Z"));
  setHouseholdCalendarTimeZone("Africa/Lusaka"); await Promise.resolve(); // subscribers hear of it in a microtask
  const user = userEvent.setup(); renderAction();
  await user.click(screen.getByRole("button", { name: "Confirm receipt" }));
  expect(screen.getByLabelText("Date the bank credited it")).toHaveAttribute("max", "2026-11-22");
});

it("A-36: warns importers of the double count and confirms exactly face less withholding", async () => {
  mocks.request.mockResolvedValue({ status: 200, json: async () => ({ data: { id: "bill", status: "matured" } }) });
  const user = userEvent.setup(); renderAction();
  await user.click(screen.getByRole("button", { name: "Confirm receipt" }));
  expect(screen.getByText(/Expected bank credit: ZMW 9700.00/)).toBeVisible();
  expect(screen.getByRole("note")).toHaveTextContent("If you import bank statements, skip this credit's line there, or you will count it twice.");
  expect(screen.getByRole("option", { name: "Kwacha cash" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Dollar cash" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Date the bank credited it"), { target: { value: "2026-10-02" } });
  await user.click(screen.getByRole("checkbox"));
  const submit = screen.getAllByRole("button", { name: "Confirm receipt" }).find(button => button.getAttribute("type") === "submit")!;
  await user.click(submit);
  await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
  expect(mocks.request).toHaveBeenCalledWith("POST", "/api/grz/tbills/bill/confirm-receipt", { operationId: "op-1", accountId: "zmw",
    date: "2026-10-02", receiptConfirmed: true, receivedAmount: { amount: "9700.00", currency: "ZMW" } }, lifetime);
  expect(await screen.findByRole("status")).toHaveTextContent("T-bill receipt recorded.");
});

it("A-36: offers no confirmation to a view-only member or for a bill that is not due", () => {
  mocks.role = "view_only"; const { unmount } = renderAction();
  expect(screen.queryByRole("button", { name: "Confirm receipt" })).not.toBeInTheDocument(); unmount();
  mocks.role = "member"; renderAction({ ...bill, status: "active", maturityNetProceeds: undefined, maturityWithholdingTax: undefined });
  expect(screen.queryByRole("button", { name: "Confirm receipt" })).not.toBeInTheDocument();
});
