import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { focusManager, QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSecurities, useSecurity } from "../useSecurities";
import { useHoldings } from "../useHoldings";
import { usePortfolioSummary } from "../usePortfolio";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import {
  activateOperationLifetime, createOperationLifetime, retireOperationLifetime,
  type OperationLifetime,
} from "@/lib/operation-lifetime";

// Prepared source contract only; no cases have run. Real valuation hooks, query
// observers, focus events and scoped QueryClient are used. The controlled GET
// replies stand for already-authorized server results, not signed/DB evidence.
// A one-minute visible refresh reuses the existing recurring-list UI cadence;
// it is a client freshness bound, not an extension of a price's validity.
const ids = {
  subject: "11111111-1111-4111-8111-111111111111",
  household: "22222222-2222-4222-8222-222222222222",
  security: "33333333-3333-4333-8333-333333333333",
};
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  lifetime: null as { key: string; client: QueryClient; operation: OperationLifetime } | null,
}));
vi.mock("@/lib/queryClient", async original => ({
  ...await original<typeof import("@/lib/queryClient")>(), apiRequest: mocks.api,
}));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: ids.subject }, household: { id: ids.household, role: "member" } },
  lifetime: mocks.lifetime,
}) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

let client: QueryClient;
let peerChanged: boolean;
let expiryMode: boolean;
let requests: string[];
function responseFor(path: string) {
  const expired = expiryMode && new Date().toISOString().slice(0, 10) > "2026-11-15";
  // Amounts are MoneyDto (NEW-35 class).
  const selected = expired ? { price: "2.0000", total: { amount: "200.00", currency: "ZMW" } } : peerChanged
    ? { price: "7.2718", total: { amount: "727.18", currency: "ZMW" } }
    : { price: "3.1415", total: { amount: "314.15", currency: "ZMW" } };
  const security = {
    id: ids.security, symbol: "LOCAL", name: "Synthetic native security", type: "stock", currency: "ZMW",
    currentPrice: selected.price,
    valuationPrice: expired ? null : { source: "manual", effectiveDate: "2026-11-01",
      validThrough: "2026-11-15", recordedAt: "2026-11-01T00:00:00.000Z" },
  };
  let data: unknown;
  if (path === "/api/investments/securities?") data = [security];
  else if (path === `/api/investments/securities/${ids.security}`) data = security;
  else if (path === "/api/investments/holdings") data = [{ id: "holding", householdId: ids.household,
    securityId: ids.security, quantity: "100", security, currentValue: selected.total }];
  else if (path === "/api/investments/portfolio/summary") data = { totalValue: selected.total,
    totalCostBasis: { amount: "100.00", currency: "ZMW" }, totalGainLoss: { amount: "0.00", currency: "ZMW" },
    totalGainLossPercent: 0, holdingsCount: 1 };
  else throw new Error(`Unexpected valuation read: ${path}`);
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function Catalogue() {
  const query = useSecurities();
  return <output data-testid="value">{query.data?.[0]?.currentPrice ?? query.status}</output>;
}
function Detail() {
  const query = useSecurity(ids.security);
  return <output data-testid="value">{query.data?.currentPrice ?? query.status}</output>;
}
function Holdings() {
  const query = useHoldings();
  return <output data-testid="value">{query.data?.[0]?.security?.currentPrice ?? query.status}</output>;
}
function Portfolio() {
  const query = usePortfolioSummary();
  return <output data-testid="value">{query.data?.totalValue.amount ?? query.status}</output>;
}
const surfaces = [
  { name: "catalogue", View: Catalogue, initial: "3.1415", peer: "7.2718", expired: "2.0000" },
  { name: "detail", View: Detail, initial: "3.1415", peer: "7.2718", expired: "2.0000" },
  { name: "holdings", View: Holdings, initial: "3.1415", peer: "7.2718", expired: "2.0000" },
  { name: "portfolio", View: Portfolio, initial: "314.15", peer: "727.18", expired: "200.00" },
];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
  focusManager.setFocused(true);
  peerChanged = false;
  expiryMode = false;
  requests = [];
  const operation = createOperationLifetime({ subject: ids.subject, household: ids.household });
  activateOperationLifetime(operation);
  client = createDataQueryClient(undefined, operation);
  mocks.lifetime = { key: String(operation.id), client, operation };
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (method: string, path: string, body?: unknown) => {
    if (method !== "GET" || body !== undefined) throw new Error("Unexpected valuation mutation");
    requests.push(path);
    return responseFor(path);
  });
});
afterEach(() => {
  cleanup();
  retireOperationLifetime(mocks.lifetime?.operation);
  retireDataClient(client);
  mocks.lifetime = null;
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

it.each(surfaces)("refreshes another member's price in the mounted $name without local invalidation", async ({ View, initial, peer }) => {
  render(<View />, { wrapper });
  await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(initial));
  expect(requests).toHaveLength(1);
  peerChanged = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(peer));
  expect(requests).toHaveLength(2);
});

it.each(surfaces)("refreshes the $name on focus and does not poll while hidden", async ({ View, initial, peer }) => {
  render(<View />, { wrapper });
  await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(initial));
  act(() => focusManager.setFocused(false));
  peerChanged = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(requests).toHaveLength(1);
  await act(async () => { focusManager.setFocused(true); });
  await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(peer));
  expect(requests).toHaveLength(2);
});

it.each(surfaces)("withdraws an expired household mark in the mounted $name after the UTC date changes", async ({ View, initial, expired }) => {
  expiryMode = true;
  vi.setSystemTime(new Date("2026-11-15T23:59:30Z"));
  render(<View />, { wrapper });
  await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(initial));
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(expired));
  expect(requests).toHaveLength(2);
});

it.each(surfaces)("refreshes the $name when reopened even while its prior cache is young", async ({ View, initial, peer }) => {
  const first = render(<View />, { wrapper });
  await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(initial));
  first.unmount();
  peerChanged = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(requests).toHaveLength(1);
  render(<View />, { wrapper });
  await waitFor(() => expect(screen.getByTestId("value")).toHaveTextContent(peer));
  expect(requests).toHaveLength(2);
});

it("does not turn a disabled empty-instrument detail into a polling request", async () => {
  function NoInstrument() {
    const query = useSecurity("");
    return <output data-testid="status">{query.fetchStatus}</output>;
  }
  render(<NoInstrument />, { wrapper });
  expect(screen.getByTestId("status")).toHaveTextContent("idle");
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  act(() => focusManager.setFocused(false));
  await act(async () => { focusManager.setFocused(true); });
  expect(requests).toHaveLength(0);
  expect(screen.getByTestId("status")).toHaveTextContent("idle");
});
