import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { webcrypto } from "node:crypto";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Holding } from "@/hooks/useInvestments";
import type { CreateHoldingInput } from "@/hooks/investments/useHoldings";
import { investmentKeys } from "@/hooks/investments/keys";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import Investments from "@/pages/Investments";

const mocks = vi.hoisted(() => ({ api: vi.fn(), lifetime: null as OperationLifetime | null, persisted: [] as Holding[] }));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: "subject" }, household: { id: "household", role: "member" } },
  lifetime: { operation: mocks.lifetime },
}) }));
vi.mock("@/hooks/use-settings", () => ({ useDisplaySettings: () => ({ data: { currency: "ZMW", numberFormat: "US" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [{ id: "custody", name: "Synthetic custody", type: "investment", currency: "ZMW" }] }) }));
vi.mock("@/lib/queryClient", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/queryClient")>(), apiRequest: mocks.api }));
vi.mock("@/hooks/useInvestments", async importOriginal => ({
  ...await importOriginal<typeof import("@/hooks/useInvestments")>(),
  useSecurities: () => ({ data: [{ id: "security", symbol: "USDSTOCK", name: "Synthetic USD stock", currency: "USD", currentPrice: "0.10" }], isLoading: false }),
  usePortfolioSummary: () => ({ data: { totalValue: { amount: "0.00", currency: "ZMW" }, totalGainLoss: { amount: "0.00", currency: "ZMW" },
    totalGainLossPercent: 0 }, isLoading: false }),
  useInvestmentPerformance: () => ({ data: [] }),
}));
vi.mock("../components/GRZSecurities", () => ({ GRZSecurities: () => null }));
vi.mock("../components/FXImpactPanel", () => ({ FXImpactPanel: () => null }));
vi.mock("../components/TaxReport", () => ({ TaxReport: () => null }));
vi.mock("../components/PensionDashboard", () => ({ PensionDashboard: () => null }));
vi.mock("../components/RecurringInvestmentSetup", () => ({ RecurringInvestmentSetup: () => null }));
vi.mock("../components/InvestmentPerformance", () => ({ InvestmentPerformance: () => null }));
vi.mock("../components/InvestmentAllocation", () => ({ InvestmentAllocation: () => null }));

let client: QueryClient, requests: CreateHoldingInput[], post: (request: CreateHoldingInput) => Promise<unknown>;
const json = (data: unknown) => ({ json: async () => ({ data }) });
const row: Holding = { id: "created", accountId: "custody", householdId: "household", securityId: "security", quantity: "3", costBasis: "0.01",
  costBasisZmw: null, acquiredDate: "2026-11-02", acquisitionFxRate: null, createdAt: "", updatedAt: "", currentValue: { amount: "0.01", currency: "ZMW" }, gainLossPercent: 0,
  security: { id: "security", symbol: "USDSTOCK", name: "Synthetic USD stock", currency: "USD", type: "stock", currentPrice: "0.10",
    exchange: null, isOffshore: false, sector: null, cusipIsin: null, lastPriceUpdate: null, withholdingTaxRate: "0", createdAt: "", updatedAt: "" } };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("crypto", webcrypto); requests = []; mocks.persisted = [];
  mocks.lifetime = createOperationLifetime({ subject: "subject", household: "household" }); activateOperationLifetime(mocks.lifetime);
  client = createDataQueryClient(undefined, mocks.lifetime);
  post = async () => json(row);
  mocks.api.mockImplementation(async (method: string, path: string, body?: CreateHoldingInput) => {
    if (method === "GET" && path.startsWith("/api/investments/holdings")) return json(mocks.persisted.map(item => ({ ...item })));
    if (method === "POST" && path === "/api/investments/holdings" && body) { requests.push({ ...body }); return post(body); }
    throw new Error(`Unexpected test transport: ${method} ${path}`);
  });
});
afterEach(() => { cleanup(); retireDataClient(client); retireOperationLifetime(mocks.lifetime); vi.unstubAllGlobals(); });
async function page() {
  const user = userEvent.setup();
  render(<QueryClientProvider client={client}><Investments /></QueryClientProvider>);
  await screen.findByRole("heading", { name: "No Holdings Yet" });
  globalThis.expectConsoleMessage?.("warn", /Missing `Description` or `aria-describedby/);
  return user;
}
async function details(user: ReturnType<typeof userEvent.setup>, trigger = "Add Your First Holding") {
  await user.click(screen.getByRole("button", { name: trigger }));
  await user.click(screen.getByRole("button", { name: /USDSTOCK/ }));
  const form = within(screen.getByRole("dialog"));
  fireEvent.change(form.getByLabelText("Quantity *"), { target: { value: "3" } });
  fireEvent.change(form.getByLabelText("Purchase Price (USD) *"), { target: { value: "0.0017" } });
  return form;
}

it.each([["Add Your First Holding", "Add Holding"], ["Add Holding", "Add Your First Holding"]])(
  "resumes the same opening from %s through the other actual trigger %s", async (first, second) => {
    post = async () => { throw new Error("Acknowledgement lost"); };
    const user = await page(), form = await details(user, first);
    await user.click(form.getByRole("button", { name: "Add Holding" }));
    expect(await form.findByText(/result was not confirmed/i)).toBeVisible();
    const original = requests[0];
    await user.click(form.getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: second }));
    const resumed = within(screen.getByRole("dialog"));
    expect(resumed.getByLabelText("Purchase Price (USD) *")).toHaveValue(0.0017);
    expect(resumed.getByLabelText("Quantity *")).toBeDisabled();
    post = async () => json(row);
    await user.click(resumed.getByRole("button", { name: "Retry same opening" }));
    expect(requests[1]).toEqual(original);
  });

it("retains the original draft and attempt when a real holdings-query refetch removes the empty card after a lost acknowledgement", async () => {
  post = async () => { mocks.persisted = [row]; throw new Error("Acknowledgement lost"); };
  const user = await page(), form = await details(user);
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  expect(await form.findByText(/result was not confirmed/i)).toBeVisible();
  const original = requests[0];
  await act(async () => { await client.invalidateQueries({ queryKey: investmentKeys.holdingsRoot() }); });
  await waitFor(() => expect(screen.queryByRole("heading", { name: "No Holdings Yet" })).toBeNull());
  expect(screen.getByRole("dialog")).toBeVisible();
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  expect(screen.getByRole("button", { name: "Add Holding" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Add Holding" }));
  const resumed = within(screen.getByRole("dialog"));
  expect(resumed.getByLabelText("Purchase Price (USD) *")).toHaveValue(0.0017);
  expect(resumed.getByText("$0.01")).toBeVisible();
  post = async () => json(row);
  await user.click(resumed.getByRole("button", { name: "Retry same opening" }));
  expect(requests[1]).toEqual(original);
});

it("shares the in-flight synchronous latch across both actual triggers", async () => {
  let resolve!: (value: unknown) => void;
  post = () => new Promise(done => { resolve = done; });
  const user = await page(), form = await details(user);
  await user.dblClick(form.getByRole("button", { name: "Add Holding" }));
  await user.click(form.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Add Holding" }));
  const resumed = within(screen.getByRole("dialog"));
  expect(resumed.getByLabelText("Purchase Price (USD) *")).toHaveValue(0.0017);
  expect(resumed.getByLabelText("Quantity *")).toBeDisabled();
  expect(resumed.getByRole("button", { name: "Add Holding" })).toBeDisabled();
  expect(requests).toHaveLength(1);
  await act(async () => resolve(json(row)));
});

it.each(["", "2026-02-30"])("does not dispatch an incomplete or invalid calendar date %j", async date => {
  const user = await page(), form = await details(user);
  fireEvent.change(form.getByLabelText("Purchase Date"), { target: { value: date } });
  expect(form.getByRole("button", { name: "Add Holding" })).toBeDisabled();
  expect(requests).toEqual([]);
});

it("preserves an editable draft after authoritative prewrite validation400 and gives its corrected declaration a new UUID", async () => {
  post = async () => { throw Object.assign(new Error("Check the opening declaration."), { status: 400, code: "VALIDATION_ERROR" }); };
  const user = await page(), form = await details(user);
  await user.click(form.getByRole("button", { name: "Add Holding" }));
  expect(await form.findByText("Check the opening declaration.")).toBeVisible();
  expect(form.getByLabelText("Purchase Price (USD) *")).toHaveValue(0.0017);
  expect(form.getByLabelText("Purchase Date")).toBeEnabled();
  expect(form.queryByRole("button", { name: "Retry same opening" })).toBeNull();
  await user.click(form.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Add Holding" }));
  const editable = within(screen.getByRole("dialog"));
  expect(editable.getByLabelText("Purchase Price (USD) *")).toHaveValue(0.0017);
  expect(editable.getByLabelText("Purchase Date")).toBeEnabled();
  fireEvent.change(editable.getByLabelText("Purchase Date"), { target: { value: "2026-10-31" } });
  post = async () => json(row);
  await user.click(editable.getByRole("button", { name: "Add Holding" }));
  expect(requests[1].operationId).not.toBe(requests[0].operationId);
  expect(requests[1]).toEqual({ ...requests[0], operationId: requests[1].operationId, acquiredDate: "2026-10-31" });
});

it.each([{ status: 409, code: "CONFLICT" }, { status: 400, code: "UNCLASSIFIED" }])(
  "keeps the original attempt frozen for an unauthoritative $status refusal", async failure => {
    post = async () => { throw Object.assign(new Error("Result unknown"), failure); };
    const user = await page(), form = await details(user);
    await user.click(form.getByRole("button", { name: "Add Holding" }));
    expect(await form.findByText(/result was not confirmed/i)).toBeVisible();
    expect(form.getByLabelText("Quantity *")).toBeDisabled();
    post = async () => json(row);
    await user.click(form.getByRole("button", { name: "Retry same opening" }));
    expect(requests[1]).toEqual(requests[0]);
  });
