import { webcrypto } from "node:crypto";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { AddRecurringInvestmentForm } from "../AddRecurringInvestmentForm";
import { RecurringInvestmentSetup } from "../RecurringInvestmentSetup";

// These nine cases exercise existing UI and real recurring hooks, with transport and
// reference reads mocked. They establish no HTTP/session/server evidence.
// Retry/navigation/lifetime-withdrawal and action integration remain required.
const ids = { subject: "11111111-1111-4111-8111-111111111111", household: "22222222-2222-4222-8222-222222222222",
  account: "33333333-3333-4333-8333-333333333333", security: "44444444-4444-4444-8444-444444444444",
  plan: "55555555-5555-4555-8555-555555555555" };
const mocks = vi.hoisted(() => ({ api: vi.fn(), toast: vi.fn(), currency: "ZMW",
  lifetime: null as { key: string; operation: OperationLifetime; client: QueryClient } | null,
  format: vi.fn((value: number, currency = "ZMW") => `${currency} ${value.toFixed(2)}`) }));
vi.mock("@/lib/queryClient", async original => ({ ...await original<typeof import("@/lib/queryClient")>(), apiRequest: mocks.api }));
vi.mock("@/hooks/useInvestments", async () => ({
  ...await import("@/hooks/investments/useRecurringInvestments"),
  useSecurities: () => ({ data: [{ id: ids.security, symbol: "SYNSTOCK", name: "Synthetic instrument",
    type: "stock", currency: mocks.currency, currentPrice: "2.00" }], isLoading: false }),
}));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [{ id: ids.account, householdId: ids.household,
  name: "Synthetic custody", type: "investment", currency: "ZMW", isPrivate: false, ownerUserId: ids.subject }], isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/use-format", () => ({ useFormat: () => ({ formatCurrency: mocks.format }) }));
vi.mock("@/hooks/use-settings", () => ({ useDisplaySettings: () => ({ data: { timezone: "Africa/Lusaka" }, isLoading: false, isError: false }) }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: ids.subject }, household: { id: ids.household, role: "member" } },
  lifetime: mocks.lifetime, loading: false,
}) }));

const plan = { id: ids.plan, householdId: ids.household, accountId: ids.account, securityId: ids.security,
  type: "sip", frequency: "yearly", amount: "10.00", currency: "USD", nextExecutionDate: "2031-01-20",
  isActive: true, authorizationRevision: 7, authorizationInitialExecutionDate: "2030-01-20", permittedActions: [] };
const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200,
  headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks(); mocks.api.mockReset(); mocks.currency = "ZMW"; vi.stubGlobal("crypto", webcrypto);
  const operation = createOperationLifetime({ subject: ids.subject, household: ids.household });
  activateOperationLifetime(operation);
  const client = createDataQueryClient(undefined, operation);
  client.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { retry: false } });
  mocks.lifetime = { key: `${ids.subject}:${ids.household}`, operation, client };
  mocks.api.mockImplementation(async (method: string) => method === "GET" ? json([]) : json({ ...plan,
    currency: mocks.currency, authorizationStatus: "authorization_recorded" }));
});
afterEach(() => {
  cleanup();
  if (mocks.lifetime) { retireOperationLifetime(mocks.lifetime.operation); retireDataClient(mocks.lifetime.client); }
  mocks.lifetime = null; vi.unstubAllGlobals();
});
function mount(content: ReactNode) {
  return render(<QueryClientProvider client={mocks.lifetime!.client}>{content}</QueryClientProvider>);
}
async function fillCreate() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: /Funding Account|Custody account/i }));
  await user.click(screen.getByRole("option", { name: /Synthetic custody/ }));
  await user.click(screen.getByRole("combobox", { name: /Target Security|Instrument/i }));
  await user.click(screen.getByRole("option", { name: /SYNSTOCK/ }));
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "10.00" } });
  fireEvent.change(screen.getByLabelText(/Start Date|Initial date/i), { target: { value: "2031-01-20" } });
  return user;
}

it.each(["ZMW", "USD"])("submits one explicit client UUID and the instrument's native %s declaration", async currency => {
  mocks.currency = currency; mount(<AddRecurringInvestmentForm onSuccess={vi.fn()} />);
  const user = await fillCreate();
  await user.click(screen.getByRole("button", { name: /Confirm Setup|Record.*plan|Create.*plan/i }));
  await waitFor(() => expect(mocks.api.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1));
  const call = mocks.api.mock.calls.find(([method]) => method === "POST")!;
  expect(call[1]).toBe("/api/investments/recurring");
  expect(call[2]).toEqual({ operationId: expect.stringMatching(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i),
    accountId: ids.account, securityId: ids.security, type: "sip", frequency: "monthly", amount: "10.00",
    currency, nextExecutionDate: "2031-01-20" });
});

it.each([
  ["authorization_recorded", /authorization.*recorded/i],
  ["authorization_required", /authorization.*required/i],
  ["inactive", /inactive/i],
  ["pending_reconciliation", /pending.*reconciliation/i],
] as const)("displays the server's %s state without claiming executable readiness", async (status, label) => {
  mocks.api.mockResolvedValue(json([{ ...plan, authorizationStatus: status, isActive: status !== "inactive" }]));
  mount(<RecurringInvestmentSetup />);
  expect(await screen.findByText(label)).toBeVisible();
  expect(screen.queryByText(/ready to execute|execution guaranteed/i)).toBeNull();
});

it("formats the native plan denomination independently of the household display currency", async () => {
  mocks.api.mockResolvedValue(json([{ ...plan, authorizationStatus: "authorization_recorded" }]));
  mount(<RecurringInvestmentSetup />);
  await waitFor(() => expect(mocks.format).toHaveBeenCalled());
  expect(mocks.format).toHaveBeenCalledWith(10, "USD");
});

it("shows a read error and retry separately from an empty recurring list", async () => {
  mocks.api.mockRejectedValue(new Error("Synthetic recurring source unavailable"));
  mount(<RecurringInvestmentSetup />);
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("button", { name: /retry|try again/i })).toBeVisible();
  expect(screen.queryByText(/No active automations|No recurring plans/i)).toBeNull();
});

it("does not promise cash debit, fixed morning execution or a funds-based retry policy", async () => {
  mount(<RecurringInvestmentSetup />);
  expect(await screen.findByRole("heading", { name: "Recurring Investments" })).toBeVisible();
  expect(screen.queryByText(/scheduled morning|insufficient funds|notify you 24 hours/i)).toBeNull();
  cleanup(); mount(<AddRecurringInvestmentForm onSuccess={vi.fn()} />);
  expect(screen.queryByText(/deduct funds/i)).toBeNull();
});
