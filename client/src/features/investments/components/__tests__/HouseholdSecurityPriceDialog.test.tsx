import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SessionHouseholdRole } from "@shared/session-status";
import type { Holding } from "@/hooks/investments/types";
import {
  activateOperationLifetime, createOperationLifetime, retireOperationLifetime,
  type OperationLifetime,
} from "@/lib/operation-lifetime";
import { HoldingsList } from "../HoldingsList";
import { HouseholdPriceRecovery, HouseholdPriceTrigger, HouseholdSecurityPriceProvider } from "../HouseholdSecurityPriceDialog";
import Investments from "@/pages/Investments";

// Real form, existing holdings caller, QueryClient and operation lifetime.
// Only session/transport/toast adapters are replaced. These are unrun client
// source oracles, not signed HTTP, server storage or built-browser evidence.
const mocks = vi.hoisted(() => ({
  api: vi.fn(), toast: vi.fn(), role: "owner" as SessionHouseholdRole,
  lifetime: null as { operation: OperationLifetime; client: QueryClient } | null,
}));
vi.mock("@/lib/queryClient", async original => ({
  ...await original<typeof import("@/lib/queryClient")>(), apiRequest: mocks.api,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: mocks.lifetime?.operation.expectations?.subject },
    household: { id: mocks.lifetime?.operation.expectations?.household, role: mocks.role } },
  lifetime: mocks.lifetime,
}) }));
vi.mock("../RecordInvestmentTransactionModal", () => ({
  RecordInvestmentTransactionModal: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("../HoldingOpeningProvider", () => ({
  HoldingOpeningProvider: ({ children }: { children: ReactNode }) => children,
  useOpenHolding: () => vi.fn(),
}));
vi.mock("@/hooks/useInvestments", async original => ({
  ...await original<typeof import("@/hooks/useInvestments")>(),
  useHoldings: () => ({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() }),
}));
vi.mock("@/features/investments/hooks/useInvestmentsData", () => ({ useInvestmentsData: () => ({
  displayCurrency: "ZMW", setDisplayCurrency: vi.fn(), timeframe: "1M", setTimeframe: vi.fn(),
  isLoading: false, holdingsLoading: false, holdings: [], summaryState: "unavailable",
  performanceHistory: [], allocationData: [], totalValue: 0, totalGainLoss: 0, totalGainLossPercent: 0,
  formatCurrency: (amount: number) => String(amount),
}) }));

const ids = {
  subject: "11111111-1111-4111-8111-111111111111",
  household: "22222222-2222-4222-8222-222222222222",
  security: "33333333-3333-4333-8333-333333333333",
  override: "44444444-4444-4444-8444-444444444444",
};
interface PriceIntent { price: string; date: string; validThrough: string }
const holding: Holding = {
  id: "holding", householdId: ids.household, accountId: "account", securityId: ids.security,
  quantity: "100", costBasis: "100.00", costBasisZmw: "100.00", acquiredDate: null,
  acquisitionFxRate: null, createdAt: "2026-01-01", updatedAt: "2026-01-01",
  security: {
    id: ids.security, symbol: "LOCAL", name: "Synthetic USD instrument", type: "stock", currency: "USD",
    currentPrice: "2.00", exchange: null, isOffshore: true, sector: null, cusipIsin: null,
    lastPriceUpdate: null, withholdingTaxRate: "0.00", createdAt: "2026-01-01", updatedAt: "2026-01-01",
  },
};
let clients: QueryClient[];
const deferredReplies: Array<() => void> = [];
function scope(household = ids.household) {
  if (mocks.lifetime) retireOperationLifetime(mocks.lifetime.operation);
  const operation = createOperationLifetime({ subject: ids.subject, household });
  activateOperationLifetime(operation);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  mocks.lifetime = { operation, client };
}
function tree(row: Holding | null = holding) {
  return <QueryClientProvider client={mocks.lifetime!.client}>
    <HouseholdSecurityPriceProvider>
      <HouseholdPriceRecovery />
      <HouseholdPriceTrigger />
      {row && <HoldingsList holdings={[row]} displayCurrency="ZMW" formatCurrency={(amount, currency) => `${currency} ${amount}`} />}
    </HouseholdSecurityPriceProvider>
  </QueryClientProvider>;
}
function reply(intent: PriceIntent) {
  return new Response(JSON.stringify({ success: true, data: {
    id: ids.override, householdId: ids.household, securityId: ids.security, currency: "USD",
    price: intent.price, effectiveDate: intent.date, validThrough: intent.validThrough,
  } }), { status: 200, headers: { "Content-Type": "application/json" } });
}
function open() {
  fireEvent.click(screen.getByRole("button", { name: "Record household price for LOCAL" }));
}
function fill(price = "3.1415", date = "2026-11-01", validThrough = "2026-11-30") {
  fireEvent.change(screen.getByLabelText("Price per unit (USD)"), { target: { value: price } });
  fireEvent.change(screen.getByLabelText("Effective date"), { target: { value: date } });
  fireEvent.change(screen.getByLabelText("Valid through (inclusive)"), { target: { value: validThrough } });
}
function submit() {
  fireEvent.submit(screen.getByRole("form", { name: "Household valuation price" }));
}
beforeEach(() => {
  clients = [];
  mocks.role = "owner";
  mocks.lifetime = null;
  mocks.api.mockReset();
  mocks.toast.mockReset();
  scope();
  mocks.api.mockImplementation(async (_method: string, _path: string, body: PriceIntent) => reply(body));
});
afterEach(async () => {
  cleanup();
  for (const release of deferredReplies.splice(0)) release();
  await Promise.resolve();
  retireOperationLifetime();
  clients.forEach(client => client.clear());
  vi.restoreAllMocks();
});

it.each(["owner", "admin"] as const)("lets a current %s record exact native terms with an explicit end date", async role => {
  mocks.role = role;
  render(tree());
  open();
  expect(screen.getByLabelText("Valid through (inclusive)")).toHaveValue("");
  expect(screen.getByText(/This values your household's holdings/)).toBeInTheDocument();
  fill();
  submit();
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Household price recorded" })));
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(mocks.api).toHaveBeenCalledWith("PUT", `/api/investments/securities/${ids.security}/price`, {
    price: "3.1415", date: "2026-11-01", validThrough: "2026-11-30",
  }, mocks.lifetime!.operation);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each(["member", "professional", "view_only"] as const)("offers no price write to %s", role => {
  mocks.role = role;
  render(tree());
  expect(screen.queryByRole("button", { name: "Record household price for LOCAL" })).not.toBeInTheDocument();
  expect(mocks.api).not.toHaveBeenCalled();
});

it("requires both valid calendar dates and ordered inclusive bounds before transport", () => {
  render(tree());
  open();
  fill("3.1415", "2026-11-01", "");
  submit();
  expect(mocks.api).not.toHaveBeenCalled();
  fill("3.1415", "2026-11-30", "2026-11-01");
  submit();
  expect(mocks.api).not.toHaveBeenCalled();
  fill("3.1415", "0000-01-01", "2026-11-30");
  submit();
  expect(mocks.api).not.toHaveBeenCalled();
});

it("preserves the rejected overlap draft and asks the owner to change its dates explicitly", async () => {
  const conflict = Object.assign(new Error("These dates overlap 2026-11-01 through 2026-11-30. Resolve which price should apply."), { status: 409 });
  mocks.api.mockRejectedValueOnce(conflict);
  render(tree());
  open();
  fill();
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent("2026-11-01 through 2026-11-30");
  expect(screen.getByLabelText("Price per unit (USD)")).toHaveValue("3.1415");
  expect(screen.getByLabelText("Effective date")).toHaveValue("2026-11-01");
  expect(screen.getByLabelText("Valid through (inclusive)")).toHaveValue("2026-11-30");
  fill("3.1415", "2026-12-01", "2026-12-31");
  submit();
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  expect(mocks.api.mock.calls[1][2]).toEqual({ price: "3.1415", date: "2026-12-01", validThrough: "2026-12-31" });
});

it("admits one write synchronously and keeps the pending dialog open", async () => {
  let release!: () => void;
  mocks.api.mockImplementationOnce((_method: string, _path: string, body: PriceIntent) => new Promise<Response>(resolve => {
    release = () => resolve(reply(body));
    deferredReplies.push(release);
  }));
  render(tree());
  open();
  fill();
  act(() => { submit(); submit(); });
  expect(mocks.api).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByLabelText("Price per unit (USD)")).toBeDisabled();
  await act(async () => release());
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("retries an unconfirmed write with the immutable original terms after reopening", async () => {
  mocks.api.mockRejectedValueOnce(new TypeError("Response lost"));
  render(tree());
  open();
  fill();
  submit();
  await screen.findByText(/Recording was not confirmed/);
  expect(screen.getByLabelText("Price per unit (USD)")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Change security" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Review unconfirmed price" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry original price" }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  expect(mocks.api.mock.calls[1][2]).toEqual(mocks.api.mock.calls[0][2]);
  expect(mocks.api.mock.calls[1][3]).toBe(mocks.api.mock.calls[0][3]);
});

it("does not announce success or discard the draft for a mismatched success response", async () => {
  mocks.api.mockResolvedValueOnce(reply({ price: "9.99", date: "2026-11-01", validThrough: "2026-11-30" }));
  render(tree());
  open();
  fill();
  submit();
  await screen.findByText(/Recording was not confirmed/);
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Retry original price" })).toBeInTheDocument();
});

it("suppresses old completion effects after the household operation changes", async () => {
  let release!: () => void;
  mocks.api.mockImplementationOnce((_method: string, _path: string, body: PriceIntent) => new Promise<Response>(resolve => {
    release = () => resolve(reply(body));
    deferredReplies.push(release);
  }));
  const oldClient = mocks.lifetime!.client;
  const invalidateOld = vi.spyOn(oldClient, "invalidateQueries");
  const view = render(tree());
  open();
  fill();
  submit();
  scope("55555555-5555-4555-8555-555555555555");
  const invalidateNew = vi.spyOn(mocks.lifetime!.client, "invalidateQueries");
  view.rerender(tree());
  await act(async () => release());
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(invalidateOld).not.toHaveBeenCalled();
  expect(invalidateNew).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not submit a still-mounted draft after its operation is retired", () => {
  render(tree());
  open();
  fill();
  retireOperationLifetime(mocks.lifetime!.operation);
  submit();
  expect(mocks.api).not.toHaveBeenCalled();
});

it("does not apply completion effects after the investment page unmounts", async () => {
  let release!: () => void;
  mocks.api.mockImplementationOnce((_method: string, _path: string, body: PriceIntent) => new Promise<Response>(resolve => {
    release = () => resolve(reply(body));
    deferredReplies.push(release);
  }));
  const invalidate = vi.spyOn(mocks.lifetime!.client, "invalidateQueries");
  const view = render(tree());
  open();
  fill();
  submit();
  view.unmount();
  await act(async () => release());
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});

it("refreshes existing investment, account and goal caches only after the matching receipt", async () => {
  const client = mocks.lifetime!.client;
  const affectedKeys = [["investments", "holdings"], ["investments", "portfolio", "summary"],
    ["accounts", "summary"], ["goals", "detail", "goal"]];
  for (const key of affectedKeys) client.setQueryData(key, { existing: true });
  client.setQueryData(["transactions", "list"], { existing: true });
  render(tree());
  open();
  fill();
  submit();
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Household price recorded" })));
  for (const key of affectedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(["transactions", "list"])?.isInvalidated).toBe(false);
});

it("keeps the draft and recovery outside a disappearing holdings-query layout", async () => {
  let release!: () => void;
  mocks.api.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => {
    release = () => reject(new TypeError("Response lost"));
    deferredReplies.push(release);
  }));
  const view = render(tree());
  open();
  fill();
  view.rerender(tree(null));
  expect(screen.getByLabelText("Price per unit (USD)")).toHaveValue("3.1415");
  submit();
  await act(async () => release());
  await screen.findByText(/Recording was not confirmed/);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Review unconfirmed price" }));
  fireEvent.click(screen.getByRole("button", { name: "Retry original price" }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Household price recorded" })));
  expect(mocks.api).toHaveBeenCalledTimes(2);
  expect(mocks.api.mock.calls[1][2]).toEqual(mocks.api.mock.calls[0][2]);
});

it.each(["owner", "admin"] as const)("lets a current %s enter the first price from the real page's valuation-error branch", async role => {
  mocks.role = role;
  mocks.api.mockImplementation(async (method: string, _path: string, body?: PriceIntent) => {
    if (method === "GET") return new Response(JSON.stringify({ success: true, data: [{
      ...holding.security, currentPrice: null, valuationPrice: null,
    }] }), { status: 200 });
    if (!body) throw new Error("Missing price intent");
    return reply(body);
  });
  render(<QueryClientProvider client={mocks.lifetime!.client}><Investments /></QueryClientProvider>);
  expect(screen.getByText("Couldn't load your investments")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Record household price for LOCAL" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Record household price" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose LOCAL (USD)" }));
  expect(screen.getByLabelText("Price per unit (USD)")).toHaveValue("");
  expect(screen.getByLabelText("Valid through (inclusive)")).toHaveValue("");
  fill();
  submit();
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Household price recorded" })));
  expect(mocks.api.mock.calls.filter(([method]) => method === "PUT")).toHaveLength(1);
});

it("lets an unlocked error-branch draft change security without writing the mistaken selection", async () => {
  mocks.api.mockImplementation(async (method: string) => {
    if (method !== "GET") throw new Error("A draft selection must not write");
    return new Response(JSON.stringify({ success: true, data: [holding.security, {
      ...holding.security, id: "66666666-6666-4666-8666-666666666666", symbol: "OTHER", currency: "ZMW",
      currentPrice: null, valuationPrice: null,
    }] }), { status: 200 });
  });
  render(<QueryClientProvider client={mocks.lifetime!.client}><Investments /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Record household price" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose LOCAL (USD)" }));
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Record household price" }));
  expect(screen.getByLabelText("Price per unit (USD)")).toHaveValue("3.1415");
  fireEvent.click(screen.getByRole("button", { name: "Change security" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose OTHER (ZMW)" }));
  expect(screen.getByLabelText("Price per unit (ZMW)")).toHaveValue("");
  expect(screen.getByLabelText("Effective date")).toHaveValue("");
  expect(screen.getByLabelText("Valid through (inclusive)")).toHaveValue("");
  expect(mocks.api.mock.calls.every(([method]) => method === "GET")).toBe(true);
});
