import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import { useHoldings } from "@/hooks/investments/useHoldings";
import { usePortfolioSummary } from "@/hooks/investments/usePortfolio";
import { investmentKeys } from "@/hooks/investments/keys";
import { SettingsProvider } from "@/contexts/SettingsContext";
import Investments from "@/pages/Investments";
import InvestmentSummaryWidget from "@/components/dashboard/InvestmentSummaryWidget";

type Unit = "ZMW" | "USD";
const mocks = vi.hoisted(() => ({ api: vi.fn(), resolved: null as Unit | null, failUsd: false,
  holdUsd: false, failSummaryUsd: false, failHoldingsUsd: false, unknownBasis: false, displayCurrency: "ZMW", release: [] as Array<() => void> }));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ status: null, lifetime: null }) }));
vi.mock("@/hooks/use-settings", () => ({ useDisplaySettings: () => ({ data: { currency: mocks.displayCurrency, numberFormat: "US", theme: "light" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/queryClient", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/queryClient")>(), apiRequest: mocks.api }));
vi.mock("@/hooks/useInvestments", async importOriginal => ({
  ...await importOriginal<typeof import("@/hooks/useInvestments")>(), useInvestmentPerformance: () => ({ data: [] }),
}));
vi.mock("../components/GRZSecurities", () => ({ GRZSecurities: () => null }));
vi.mock("../components/FXImpactPanel", () => ({ FXImpactPanel: () => null }));
vi.mock("../components/TaxReport", () => ({ TaxReport: () => null }));
vi.mock("../components/PensionDashboard", () => ({ PensionDashboard: () => null }));
vi.mock("../components/RecurringInvestmentSetup", () => ({ RecurringInvestmentSetup: () => null }));
vi.mock("../components/InvestmentPerformance", () => ({ InvestmentPerformance: () => null }));
// Keep the real allocation amounts/empty state; only chart layout is isolated.
vi.mock("recharts", () => ({ ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: ReactNode }) => <div>{children}</div>, Pie: () => null, Cell: () => null, Tooltip: () => null }));

// Independent wire oracle; these are DTO fixtures, not a mocked converter.
// The companion signed DB file proves the actual rates/valuation calculation.
// Amounts are MoneyDto in the selected base currency (NEW-35 class).
const dto = (amount: string, unit: string) => ({ amount, currency: unit });
const wire = { ZMW: { values: ["100.00", "200.00"], costs: ["80.00", "160.00"], gains: ["20.00", "40.00"], rates: [1, 20], total: "300.00", cost: "240.00", gain: "60.00" },
  USD: { values: ["5.00", "10.00"], costs: ["4.00", "8.00"], gains: ["1.00", "2.00"], rates: [0.05, 1], total: "15.00", cost: "12.00", gain: "3.00" } };
function envelope(unit: Unit, summary: boolean) {
  const expected = wire[unit];
  const unknown = mocks.unknownBasis && unit === "ZMW";
  const data = summary ? { totalValue: dto(expected.total, unit), totalCostBasis: dto(expected.cost, unit), totalGainLoss: dto(expected.gain, unit),
    totalGainLossPercent: 25, holdingsCount: 2, ...(unknown && { totalCostBasis: null, totalGainLoss: null, totalGainLossPercent: null }) } : ["ZMW", "USD"].map((native, index) => ({
      id: native + "-holding", householdId: "household", accountId: "custody", securityId: native + "-security",
      quantity: native === "ZMW" ? "10.00000000" : "2.00000000", costBasis: native === "ZMW" ? "80.00" : "8.00",
      costBasisBase: dto(expected.costs[index], unit),
      costBasisZmw: native === "ZMW" ? "80.00" : "160.00", acquisitionFxRate: native === "ZMW" ? "1.0000" : "20.0000",
      acquiredDate: null, createdAt: "", updatedAt: "", currentValue: dto(expected.values[index], unit), gainLoss: dto(expected.gains[index], unit),
      gainLossPercent: 25, fxRateUsed: expected.rates[index], security: { id: native + "-security", symbol: "R12" + native,
        name: "Synthetic " + native + " position", type: "stock", currency: native, currentPrice: native === "ZMW" ? "10.0000" : "5.0000",
        sector: null, lastPriceUpdate: null },
      ...(unknown && native === "USD" && { costBasisBase: null, costBasisZmw: null, acquisitionFxRate: null, gainLoss: null, gainLossPercent: null }),
    }));
  return new Response(JSON.stringify({ success: true, data, meta: { baseCurrency: unit } }), { status: 200, headers: { "content-type": "application/json" } });
}
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.resolved = null; mocks.failUsd = false; mocks.holdUsd = false;
  mocks.failSummaryUsd = false; mocks.failHoldingsUsd = false; mocks.release = [];
  mocks.unknownBasis = false;
  mocks.displayCurrency = "ZMW";
  client = createDataQueryClient();
  mocks.api.mockImplementation(async (method: string, path: string) => {
    const url = new URL(path, "http://synthetic.invalid");
    if (method !== "GET" || !["/api/investments/holdings", "/api/investments/portfolio/summary"].includes(url.pathname)) throw new Error("Unexpected unit-test transport");
    const requested = url.searchParams.get("currency") || url.searchParams.get("baseCurrency") || "ZMW";
    const summary = url.pathname.endsWith("/summary");
    if (requested === "USD" && (mocks.holdUsd || (summary && mocks.failSummaryUsd))) await new Promise<void>(done => { mocks.release.push(done); });
    if (requested === "USD" && mocks.failUsd) throw Object.assign(new Error("Invalid currency selection"), { status: 400, code: "VALIDATION_ERROR" });
    if (requested === "USD" && summary && mocks.failSummaryUsd) throw new TypeError("Summary response unavailable");
    if (requested === "USD" && !summary && mocks.failHoldingsUsd) throw new TypeError("Holdings response unavailable");
    return envelope(mocks.resolved || requested as Unit, summary);
  });
});
afterEach(() => { cleanup(); mocks.release.forEach(done => done()); retireDataClient(client); });

it.each(["ZMW", "USD"] as const)("keeps resolved%s metadata beside actual hook monetary values", async unit => {
  mocks.resolved = unit;
  const { result } = renderHook(() => ({ holdings: useHoldings({ baseCurrency: "USD" }), summary: usePortfolioSummary("USD") }), { wrapper });
  await waitFor(() => expect(result.current.holdings.isSuccess && result.current.summary.isSuccess).toBe(true));
  expect(result.current.holdings.data?.map(row => ({ unit: row.baseCurrency, value: row.currentValue })))
    .toEqual(wire[unit].values.map(value => ({ unit, value: dto(value, unit) })));
  expect(result.current.summary.data).toMatchObject({ baseCurrency: unit, totalValue: dto(wire[unit].total, unit), totalCostBasis: dto(wire[unit].cost, unit) });
});

it("renders actual converted row values and summary after the real page selector changes to USD", async () => {
  const user = userEvent.setup(); render(<Investments />, { wrapper });
  await screen.findByText("K300.00", { exact: true });
  await user.click(screen.getByRole("button", { name: "USD" }));
  expect(await screen.findByText("$15.00", { exact: true })).toBeVisible();
  const zmw = within(screen.getByRole("row", { name: /R12ZMW/ })), usd = within(screen.getByRole("row", { name: /R12USD/ }));
  expect(zmw.getByRole("cell", { name: "$5.00" })).toBeVisible();
  expect(usd.getByRole("cell", { name: "$10.00" })).toBeVisible();
  expect(zmw.getByRole("cell", { name: "K10.00" })).toBeVisible(); // quoted price stays native
  expect(usd.getByRole("cell", { name: "$5.00" })).toBeVisible();
  expect(screen.queryByText("$300.00", { exact: true })).toBeNull();
});

it("shows current market value and withholds returns for unverified ZMW cost", async () => {
  mocks.unknownBasis = true;
  const user = userEvent.setup();
  render(<Investments />, { wrapper });
  await screen.findByText("K300.00", { exact: true });
  const title = within(screen.getByRole("heading", { name: "Investments" }).parentElement!);
  expect(title.getByText("Gain/loss unavailable")).toBeVisible();
  const foreign = within(screen.getByRole("row", { name: /R12USD/ }));
  expect(foreign.getByRole("cell", { name: "K200.00" })).toBeVisible();
  expect(foreign.getByRole("cell", { name: "Unavailable" })).toBeVisible();
  expect(within(screen.getByRole("row", { name: /R12ZMW/ })).getByText("+25.0%")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "USD" }));
  expect(await screen.findByText("$15.00", { exact: true })).toBeVisible();
  expect(within(screen.getByRole("row", { name: /R12USD/ })).getByText("+25.0%")).toBeVisible();
});

it("keeps the dashboard market value when the portfolio return is unavailable", async () => {
  mocks.unknownBasis = true;
  mocks.displayCurrency = "USD";
  render(<SettingsProvider><InvestmentSummaryWidget /></SettingsProvider>, { wrapper });
  expect(await screen.findByText("K300.00", { exact: true })).toBeVisible();
  expect(screen.getByText("Gain/loss unavailable")).toBeVisible();
});

it("never relabels a resolved ZMW response as USD when its metadata disagrees with the selector", async () => {
  const user = userEvent.setup(); render(<Investments />, { wrapper });
  await screen.findByText("K300.00", { exact: true }); mocks.resolved = "ZMW";
  await user.click(screen.getByRole("button", { name: "USD" }));
  await waitFor(() => expect(mocks.api.mock.calls.filter(([, path]) => String(path).includes("USD"))).toHaveLength(2));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByText("$300.00", { exact: true })).toBeNull();
  expect(screen.queryByRole("cell", { name: "$100.00" })).toBeNull();
  expect(screen.queryByRole("cell", { name: "$200.00" })).toBeNull();
  // Either keep the true resolved-unit display or reject the unit mismatch.
  // A blank/zero fallback alone is not a valid positive financial oracle.
  const truthful = screen.queryByText("K300.00", { exact: true }) || screen.queryByText(/couldn.t load your investments|valuation unavailable|currency.*mismatch/i);
  expect(truthful).toBeVisible();
});

it("does not flash old ZMW amounts under USD while the new selection is pending or rejected", async () => {
  const user = userEvent.setup(); render(<Investments />, { wrapper });
  await screen.findByText("K300.00", { exact: true }); mocks.holdUsd = true; mocks.failUsd = true;
  await user.click(screen.getByRole("button", { name: "USD" }));
  await waitFor(() => expect(mocks.release).toHaveLength(2));
  expect(screen.queryByText("$300.00", { exact: true })).toBeNull();
  expect(screen.queryByRole("cell", { name: "$100.00" })).toBeNull();
  expect(screen.queryByRole("cell", { name: "$200.00" })).toBeNull();
  await act(async () => { mocks.release.forEach(done => done()); });
  expect(await screen.findByText("Couldn't load your investments", { exact: true })).toBeVisible();
  expect(screen.queryByText("$300.00", { exact: true })).toBeNull();
});

it("keeps header money truthful when only the USD summary is pending then fails while holdings succeed", async () => {
  const user = userEvent.setup(); render(<Investments />, { wrapper });
  await screen.findByText("K300.00", { exact: true }); mocks.failSummaryUsd = true;
  await user.click(screen.getByRole("button", { name: "USD" }));
  await waitFor(() => expect(mocks.release).toHaveLength(1));
  await waitFor(() => expect(client.getQueryState(investmentKeys.holdings("USD"))?.status).toBe("success"));
  expect(client.getQueryData(investmentKeys.holdings("USD"))).toMatchObject({ meta: { baseCurrency: "USD" },
    data: [expect.objectContaining({ currentValue: dto("5.00", "USD") }), expect.objectContaining({ currentValue: dto("10.00", "USD") })] });
  const assertTruthfulHeader = () => {
    const header = within(screen.getByRole("heading", { name: "Investments" }).parentElement!);
    // Only the summary header is under test. Genuine zero amounts elsewhere
    // must not make this a global prohibition on rendering money zero.
    expect(header.queryByText("$0.00", { exact: true })).toBeNull();
    expect(header.queryByText("$300.00", { exact: true })).toBeNull();
    const prior = header.queryByText("K300.00", { exact: true });
    const state = header.queryByText(/loading|unavailable|not available|couldn.t load|unable to load/i);
    expect(prior || state).toBeVisible();
  };
  assertTruthfulHeader();
  await act(async () => { mocks.release[0](); });
  await waitFor(() => expect(client.getQueryState(investmentKeys.portfolioSummary("USD"))?.status).toBe("error"));
  expect(client.getQueryState(investmentKeys.holdings("USD"))?.status).toBe("success");
  await waitFor(assertTruthfulHeader);
});

it.each(["new selection", "cached refetch"] as const)("withholds allocation after holdings-only failure during %s while the summary succeeds", async mode => {
  const user = userEvent.setup(); render(<Investments />, { wrapper });
  await screen.findByText("K300.00", { exact: true });
  await user.click(screen.getByRole("tab", { name: "Allocation" }));
  const panel = within(screen.getByRole("tabpanel", { name: "Allocation" }));
  expect(panel.getByText("Total Assets", { exact: true })).toBeVisible();
  expect(panel.getAllByText("K300.00", { exact: true })).toHaveLength(2);
  panel.getAllByText("K300.00", { exact: true }).forEach(amount => expect(amount).toBeVisible());
  expect(panel.getByText("Stocks", { exact: true })).toBeVisible();
  mocks.failHoldingsUsd = mode === "new selection";
  await user.click(screen.getByRole("button", { name: "USD" }));
  if (mode === "cached refetch") {
    expect(await panel.findAllByText("$15.00", { exact: true })).toHaveLength(2);
    panel.getAllByText("$15.00", { exact: true }).forEach(amount => expect(amount).toBeVisible());
    mocks.failHoldingsUsd = true;
    await act(async () => { await client.invalidateQueries({ queryKey: investmentKeys.holdings("USD") }); });
  }
  await waitFor(() => expect(client.getQueryState(investmentKeys.holdings("USD"))?.status).toBe("error"));
  await waitFor(() => expect(client.getQueryState(investmentKeys.portfolioSummary("USD"))?.status).toBe("success"));
  expect(client.getQueryData(investmentKeys.portfolioSummary("USD"))).toMatchObject({
    meta: { baseCurrency: "USD" }, data: { totalValue: dto("15.00", "USD") },
  });
  await waitFor(() => expect(panel.queryByText("Total Assets", { exact: true })).toBeNull());
  expect(panel.queryByText("Add holdings to see allocation", { exact: true })).toBeNull();
  expect(panel.queryByText("Asset Class Breakdown", { exact: true })).toBeNull();
  expect(panel.queryAllByText("$15.00", { exact: true })).toHaveLength(0);
  expect(panel.getByText(/unavailable|couldn.t load|unable to load/i)).toBeVisible();
  mocks.failHoldingsUsd = false;
  await act(async () => { await client.invalidateQueries({ queryKey: investmentKeys.holdings("USD") }); });
  expect(await panel.findAllByText("$15.00", { exact: true })).toHaveLength(2);
  panel.getAllByText("$15.00", { exact: true }).forEach(amount => expect(amount).toBeVisible());
  expect(panel.getByText("Stocks", { exact: true })).toBeVisible();
});
