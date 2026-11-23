/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { accountKeys } from "@/hooks/useAccounts";
import { useAccountsData } from "../hooks/useAccountsData";
import { NetWorthChart } from "../components/NetWorthChart";
import { NetWorthSummary } from "../components/NetWorthSummary";

const endpoint = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, accountsApi: { ...actual.accountsApi, getNetWorthHistory: endpoint } };
});
vi.mock("@/hooks", async () => {
  const { useNetWorthHistory } = await vi.importActual<typeof import("@/hooks/useAccounts")>("@/hooks/useAccounts");
  return { useNetWorthHistory,
    useAccounts: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
    // A different cached endpoint must never certify the history frame's current value.
    useNetWorthSummary: () => ({ data: { totalAssets: 500, totalLiabilities: 0, netWorth: 500, currency: "USD" }, isLoading: false }),
    useExportAccountsSummary: () => ({ mutate: vi.fn(), isPending: false }) };
});
vi.mock("../hooks/useAccountOwnerPreference", () => ({ useAccountOwnerPreference: () => ({
  ownerUserId: "all", ownerPreferencesReady: true, ownerPreferencesLoading: false,
}) }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div aria-label="Net worth plot">{children}</div>,
  AreaChart: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Area: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null,
}));
const key = accountKeys.netWorthHistories();
const frame = () => ({ accounts: [], series: [{ date: "2026-10-31", netWorth: 50, assets: 50, liabilities: 0,
  currency: "ZMW", provenance: "captured_snapshot" }],
  latest: { assets: 500, liabilities: 0, netWorth: 500, currency: "USD" }, currentStatus: "available",
  historyCoverage: "verified_snapshots_only", unattestedHistory: "not_charted", scope: "user" });
const clients: QueryClient[] = [];
function Screen() {
  const state = useAccountsData();
  return <><NetWorthChart {...state} data={state.chartData} currentNetWorth={state.summaryData.netWorthValue}
    currency={state.summaryData.currency} unavailable={state.summaryData.available === false} />
    <NetWorthSummary data={state.summaryData} groupedAccounts={{}} assetGroups={[]} liabilityGroups={[]}
      summaryMode="totals" onSummaryModeChange={vi.fn()} onExport={vi.fn()} isExporting={false} getGroupTotal={() => 0} /></>;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><Screen /></QueryClientProvider>);
  return client;
}
async function visible() {
  await waitFor(() => expect(screen.getByRole("table")).toHaveTextContent(/ZMW.*50\.00/));
  expect(screen.getAllByText(/USD.*500\.00/).length).toBeGreaterThan(0);
}
function withdrawn() {
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Net worth plot")).not.toBeInTheDocument();
  expect(screen.queryByText(/USD.*500\.00/)).not.toBeInTheDocument();
  expect(screen.queryByText(/No proven snapshots in this range/i)).not.toBeInTheDocument();
}
function observedHistory(client: QueryClient) {
  // Prefix matching must be explicit. Do not filter by 'active': a disabled
  // observer still has a subscribed query whose retained values need guarding.
  const matches = client.getQueryCache().findAll({ queryKey: key, exact: false });
  expect(matches).toHaveLength(1);
  expect(matches[0].getObserversCount()).toBe(1);
  return matches[0].state;
}
beforeEach(() => { onlineManager.setOnline(true); endpoint.mockReset(); endpoint.mockResolvedValue(frame()); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true); });

it("withdraws cached current, chart and accessible table after a mounted permission denial", async () => {
  const client = mount(); await visible();
  endpoint.mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
  await act(async () => { await client.invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(screen.getAllByText(/Unable to refresh account history/i).length).toBeGreaterThan(0));
  withdrawn();
});
it("shows an error rather than claiming empty history on a first failed request", async () => {
  endpoint.mockRejectedValue(Object.assign(new Error("Denied"), { status: 403 }));
  mount();
  await waitFor(() => expect(screen.getAllByText(/Unable to refresh account history/i).length).toBeGreaterThan(0));
  withdrawn();
});
it("withholds cached values while a real observer is paused offline", async () => {
  const client = mount(); await visible();
  act(() => { onlineManager.setOnline(false); void client.invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(observedHistory(client).fetchStatus).toBe("paused"));
  await waitFor(() => expect(screen.getAllByText(/Checking current access/i).length).toBeGreaterThan(0));
  withdrawn();
});
it("withholds cached values during an ordinary background revalidation", async () => {
  const client = mount(); await visible();
  endpoint.mockImplementation(() => new Promise(() => {}));
  act(() => { void client.invalidateQueries({ queryKey: key }); });
  await waitFor(() => expect(observedHistory(client).fetchStatus).toBe("fetching"));
  await waitFor(() => expect(screen.getAllByText(/Checking current access/i).length).toBeGreaterThan(0));
  withdrawn();
});
it("retains proven history but does not substitute a separately cached current summary", async () => {
  endpoint.mockResolvedValue({ ...frame(), latest: null, currentStatus: "unavailable" });
  mount();
  await waitFor(() => expect(screen.getByRole("table")).toHaveTextContent(/ZMW.*50\.00/));
  expect(screen.queryByText(/USD.*500\.00/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/Valuation unavailable/i).length).toBeGreaterThan(0);
});
it.each([undefined, "12!"])("preserves valid history while current denomination %s is unsupported", async currency => {
  const response = frame();
  endpoint.mockResolvedValue({ ...response, latest: { ...response.latest, currency } });
  mount();
  await waitFor(() => expect(screen.getByRole("table")).toHaveTextContent(/ZMW.*50\.00/));
  expect(screen.queryByText(/USD.*500\.00|K500\.00|ZMW.*500\.00/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/Valuation unavailable/i).length).toBeGreaterThan(0);
});
