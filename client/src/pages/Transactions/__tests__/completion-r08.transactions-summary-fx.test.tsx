/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Transactions from "@/pages/Transactions";
import type { ApiError, Transaction, TransactionSummary } from "@/lib/api";
import { transactionKeys, useTransactionSummary } from "@/hooks/useTransactions";
import { invalidateImportQueries } from "@/lib/invalidate-import-queries";
import { activateOperationLifetime, captureOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

// Preserve the real page, summary panel/views, query hooks, transport, list/rows,
// filters and selection. Replace unrelated chrome/editors and jsdom geometry.
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/pages/Transactions/TransactionsHeader", () => ({ TransactionsHeader: () => <h1>Transactions</h1> }));
vi.mock("@/pages/Transactions/TransactionsModals", () => ({
  TransactionsModals: ({ selectedTransaction }: { selectedTransaction: Transaction | null }) => selectedTransaction
    ? <section role="dialog" aria-label="Selected transaction">{selectedTransaction.name}</section> : null,
}));
vi.mock("@/components/import/ImportWizardContext", () => ({ useImportWizard: () => ({ openWizard: vi.fn() }) }));
const profile = vi.hoisted(() => ({ id: undefined as string | undefined }));
vi.mock("@/hooks/use-settings", () => ({ useProfile: () => ({ data: profile }) }));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 64, size: 64 })),
    getTotalSize: () => count * 64,
  }),
}));

const ids = { subject: "11111111-1111-4111-8111-111111111111", household: "22222222-2222-4222-8222-222222222222",
  account: "33333333-3333-4333-8333-333333333333" };
const money = (amount: string) => ({ amount, currency: "USD" });
const rows: Transaction[] = [
  { id: "44444444-4444-4444-8444-444444444444", householdId: ids.household, accountId: ids.account,
    date: "2026-02-12", name: "Visible groceries", type: "expense", amount: money("61.75"),
    isPending: false, isRecurring: false, isExcludedFromReports: false, isExcludedFromBudget: false, isPrivate: false,
    createdAt: "2026-02-12T10:00:00.000Z", updatedAt: "2026-02-12T10:00:00.000Z" },
  { id: "55555555-5555-4555-8555-555555555555", householdId: ids.household, accountId: ids.account,
    date: "2026-02-11", name: "Visible pay", type: "income", amount: money("40.00"),
    isPending: false, isRecurring: false, isExcludedFromReports: false, isExcludedFromBudget: false, isPrivate: false,
    createdAt: "2026-02-11T10:00:00.000Z", updatedAt: "2026-02-11T10:00:00.000Z" },
];
const unavailableMessage = "No trusted USD → ZMW exchange rate is available for 2026-02-12.";
const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }),
  { status: 200, headers: { "content-type": "application/json" } });
const unavailable = () => new Response(JSON.stringify({ success: false, error: {
  code: "FINANCIAL_DATA_UNAVAILABLE", message: unavailableMessage,
} }), { status: 422, headers: { "content-type": "application/json" } });
const summary = (income = "114.25", expenses = "151.50", net = "-37.25"): TransactionSummary => ({
  totalIncome: money(income), totalExpenses: money(expenses), netFlow: money(net), transactionCount: 9,
});
type Read = { url: URL; method: string; headers: Headers; credentials: RequestCredentials | undefined };
let reads: Read[], clients: QueryClient[], summaryReply: () => Response | Promise<Response>;
let mountedPages: Map<QueryClient, ReturnType<typeof render>>;
const summaryReads = () => reads.filter(read => read.url.pathname === "/api/transactions/summary");
// R11: the page also reads the saved default filter preset (not financial data).
const DEFAULT_PRESET_PATH = "/api/filter-presets/default/transactions";

function mount(search = "from=2026-02-01&to=2026-02-28", cachedClient?: QueryClient) {
  const client = cachedClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } } });
  if (!clients.includes(client)) clients.push(client);
  const location = memoryLocation({ path: `/transactions?${search}`, record: true });
  const page = render(<QueryClientProvider client={client}><Router hook={location.hook} searchHook={location.searchHook}>
    <Transactions />
  </Router></QueryClientProvider>);
  mountedPages.set(client, page);
  return client;
}
function independentClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity,
    staleTime: Infinity, refetchOnWindowFocus: false } } });
  clients.push(client);
  return client;
}
function peerSummary(client: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useTransactionSummary("2026-02-01", "2026-02-28"), { wrapper: Wrapper });
}
function heldSummary() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(complete => { resolve = complete; });
  return { promise, resolve };
}
function panel() {
  const region = screen.queryByRole("region", { name: "Transaction summary" });
  const element = region ?? screen.getByRole("heading", { name: "Summary" }).closest(".bg-card");
  if (!(element instanceof HTMLElement)) throw new Error("The actual summary card was not mounted");
  return element;
}
function assertAmount(label: string, amount: string) {
  const labelElement = within(panel()).getByText(label, { exact: true });
  const container = labelElement.parentElement;
  if (!container) throw new Error(`Missing summary value for ${label}`);
  // Both the existing USD symbol and explicit USD code identify the denomination.
  expect(container).toHaveTextContent(new RegExp(`(?:USD\\s*|\\$)${amount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  expect(container).not.toHaveTextContent(/K\s*\d|ZMW/);
}
function assertNoMoneyTotals() {
  expect(panel()).not.toHaveTextContent(/[+-]?\s*(?:\$|K|USD|ZMW)\s*[\d,]+\.\d{2}/);
  expect(within(panel()).queryByText(/^0 transactions$/)).not.toBeInTheDocument();
}
async function assertUnavailable(client: QueryClient) {
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/summary.*unavailable|unavailable.*summary/i);
  expect(alert).toHaveTextContent(unavailableMessage);
  expect(alert).toHaveTextContent("USD"); expect(alert).toHaveTextContent("ZMW"); expect(alert).toHaveTextContent("2026-02-12");
  const error = client.getQueryCache().getAll().map(query => query.state.error as ApiError | null)
    .find(candidate => candidate?.code === "FINANCIAL_DATA_UNAVAILABLE");
  expect(error).toMatchObject({ status: 422, code: "FINANCIAL_DATA_UNAVAILABLE", message: unavailableMessage });
  assertNoMoneyTotals();
}
async function assertListUsable() {
  fireEvent.click(await screen.findByRole("button", { name: /^View Visible groceries,/ }));
  expect(screen.getByRole("dialog", { name: "Selected transaction" })).toHaveTextContent("Visible groceries");
  expect(screen.queryByText("Error loading transactions")).not.toBeInTheDocument();
}
function assertSummaryRequestsBound() {
  expect(summaryReads().length).toBeGreaterThan(0);
  for (const read of summaryReads()) {
    expect(read.method).toBe("GET"); expect(read.credentials).toBe("include");
    expect(read.headers.get("X-Capital-Subject")).toBe(ids.subject);
    expect(read.headers.get("X-Capital-Household")).toBe(ids.household);
    expect(read.url.searchParams.get("startDate")).toBe("2026-02-01");
    expect(read.url.searchParams.get("endDate")).toBe("2026-02-28");
  }
}

beforeEach(() => {
  profile.id = ids.subject;
  reads = []; clients = []; mountedPages = new Map(); summaryReply = () => json(summary());
  activateOperationLifetime(createOperationLifetime({ subject: ids.subject, household: ids.household }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const read = { url: new URL(String(input), "http://localhost"), method: (init?.method || "GET").toUpperCase(),
      headers: new Headers(init?.headers), credentials: init?.credentials };
    reads.push(read);
    if (read.method === "GET" && read.url.pathname === DEFAULT_PRESET_PATH) return json(null);
    if (read.method === "GET" && read.url.pathname === "/api/transactions/summary") return summaryReply();
    if (read.method === "GET" && read.url.pathname === "/api/transactions") return new Response(JSON.stringify({
      success: true, data: rows, pagination: { limit: 50, offset: 0, count: 2, totalCount: 2, total: 2,
        page: 1, pageSize: 2, hasNext: false, hasPrev: false },
    }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`Unexpected summary test request: ${read.method} ${read.url.pathname}`);
  }));
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); retireOperationLifetime(); focusManager.setFocused(undefined); vi.unstubAllGlobals(); });

describe("FIN-17 mounted Transactions summary (UNIT, simulated HTTP)", () => {
  it.each([
    ["to=1982-03-11", "1982-02-09", "1982-03-11"],
    ["from=2090-06-10", "2090-06-10", "2090-07-10"],
  ])("anchors the displayed period to the supplied date in %s", async (query, start, end) => {
    mount(query);
    await waitFor(() => expect(summaryReads()).toHaveLength(1));
    const sent = summaryReads()[0].url.searchParams;
    expect(sent.get("startDate")).toBe(start);
    expect(sent.get("endDate")).toBe(end);
    expect(panel()).toHaveTextContent(`${start} – ${end}`);
  });

  it("waits for an identified owner before reading Mine", async () => {
    profile.id = undefined;
    mount("owner=mine");
    await act(async () => {});
    expect(reads.filter(read => read.url.pathname !== DEFAULT_PRESET_PATH)).toHaveLength(0);
    assertNoMoneyTotals();
    expect(screen.queryByText("Visible groceries")).not.toBeInTheDocument();
  });

  it.each([
    { income: "151.50", expenses: "114.25", net: "37.25", sign: "+" },
    { income: "114.25", expenses: "151.50", net: "-37.25", sign: "-" },
  ])("displays server USD totals and $sign net without re-aggregating the loaded subset", async ({ income, expenses, net, sign }) => {
    summaryReply = () => json(summary(income, expenses, net)); mount();
    await waitFor(() => assertAmount("Income", income));
    assertAmount("Expenses", expenses); assertAmount("Net Flow", "37.25");
    const netContainer = within(panel()).getByText("Net Flow", { exact: true }).parentElement;
    expect(netContainer).toHaveTextContent(new RegExp(`\\${sign}\\s*(?:USD\\s*|\\$)37\\.25`));
    expect(within(panel()).getByText("9 transactions")).toBeInTheDocument();
    expect(within(panel()).queryByText(/61\.75|40\.00|21\.75/)).not.toBeInTheDocument();
    assertSummaryRequestsBound(); await assertListUsable();
  });

  it("shows the typed FX pair/date failure without zero totals while the list remains usable", async () => {
    summaryReply = unavailable; const client = mount();
    await assertUnavailable(client); assertSummaryRequestsBound(); await assertListUsable();
  });

  it("refetches on the real import invalidator and withdraws earlier totals when that summary GET fails", async () => {
    const client = mount();
    // Currency correctness has its own controls above. Admit the original
    // numeric result here so the baseline reaches its invalidation defect.
    await waitFor(() => expect(panel()).toHaveTextContent("114.25"));
    expect(panel()).toHaveTextContent("151.50"); expect(panel()).toHaveTextContent("37.25");
    expect(summaryReads()).toHaveLength(1);
    summaryReply = unavailable;
    await act(async () => { await invalidateImportQueries(client, captureOperationLifetime()); });
    await waitFor(() => expect(summaryReads()).toHaveLength(2));
    await assertUnavailable(client);
    expect(panel()).not.toHaveTextContent(/114\.25|151\.50|37\.25/);
    assertSummaryRequestsBound(); await assertListUsable();
  });
  it("preserves high aggregate cents and USD denomination across every real panel view", async () => {
    summaryReply = () => json({ ...summary("90071992547409.91", "180143985094819.82", "-90071992547409.91"),
      transactionCount: 30, largestIncome: money("8999999999999.99"), largestExpense: money("9999999999999.99"),
      firstTransactionDate: "2026-02-01", lastTransactionDate: "2026-02-28" });
    mount();
    await waitFor(() => assertAmount("Income", "90,071,992,547,409.91"));
    assertAmount("Expenses", "180,143,985,094,819.82"); assertAmount("Net Flow", "90,071,992,547,409.91");
    expect(within(panel()).getByText("Net Flow", { exact: true }).parentElement).toHaveTextContent(/-\$90,071,992,547,409\.91/);
    expect(panel()).not.toHaveTextContent(/90,071,992,547,409\.90|180,143,985,094,819\.80/);
    fireEvent.click(within(panel()).getByRole("button", { name: "Next summary view" }));
    expect(within(panel()).getByText("Largest income", { exact: true }).parentElement).toHaveTextContent("+$8,999,999,999,999.99");
    expect(within(panel()).getByText("Largest expense", { exact: true }).parentElement).toHaveTextContent("$9,999,999,999,999.99");
    expect(within(panel()).getByText("Average transaction", { exact: true }).parentElement).toHaveTextContent("-$3,002,399,751,580.33");
    expect(within(panel()).getByText("Total income", { exact: true }).parentElement).toHaveTextContent("+$90,071,992,547,409.91");
    expect(within(panel()).getByText("Total spending", { exact: true }).parentElement).toHaveTextContent("$180,143,985,094,819.82");
    fireEvent.click(within(panel()).getByRole("button", { name: "Next summary view" }));
    expect(within(panel()).getByText("Net", { exact: true }).parentElement).toHaveTextContent("-$90,071,992,547,409.91");
    expect(panel()).toHaveTextContent("$90,071,992,547,409.91");
    expect(panel()).toHaveTextContent("$180,143,985,094,819.82");
    expect(panel()).not.toHaveTextContent(/K\s*\d|ZMW|90,071,992,547,409\.90|180,143,985,094,819\.80/);
  });
  it.each(["remount", "refocus"] as const)("discards an unresolved pre-withdrawal GET on %s", async trigger => {
    const client = independentClient();
    const old = heldSummary(), fresh = heldSummary();
    summaryReply = () => old.promise;
    mount(undefined, client);
    await waitFor(() => expect(summaryReads()).toHaveLength(1));
    summaryReply = () => fresh.promise;
    if (trigger === "remount") {
      mountedPages.get(client)!.unmount();
      mount(undefined, client);
    } else {
      act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    }
    await waitFor(() => expect(summaryReads()).toHaveLength(2));
    // This transport deliberately returns its body even after the abort.
    await act(async () => { old.resolve(json(summary("900.00", "0.00", "900.00"))); });
    assertNoMoneyTotals();
    await act(async () => { fresh.resolve(json(summary("40.00", "0.00", "40.00"))); });
    await waitFor(() => assertAmount("Income", "40.00"));
    expect(panel()).not.toHaveTextContent("900.00");
  });

  // The HTTP replies model already-authorized peer changes. These prove cache
  // isolation and fresh client readback; server authorization is covered elsewhere.
  it("rechecks another client's write on remount and withholds the old cached totals until GET completes", async () => {
    const first = independentClient(), peer = independentClient();
    mount(undefined, first); const other = peerSummary(peer);
    await waitFor(() => expect(summaryReads()).toHaveLength(2));
    await waitFor(() => assertAmount("Income", "114.25"));
    await waitFor(() => expect(other.result.current.data?.totalIncome.amount).toBe("114.25"));
    summaryReply = () => json(summary("205.00", "25.00", "180.00"));
    await act(async () => { await peer.invalidateQueries({ queryKey: transactionKeys.all }); });
    await waitFor(() => expect(other.result.current.data?.totalIncome.amount).toBe("205.00"));
    assertAmount("Income", "114.25"); // No shared invalidation reached the first client.
    mountedPages.get(first)!.unmount();
    const pending = heldSummary(); summaryReply = () => pending.promise.then(response => response.clone());
    mount(undefined, first);
    await waitFor(() => expect(summaryReads()).toHaveLength(4));
    expect(within(panel()).getByRole("status")).toHaveTextContent("Loading summary");
    assertNoMoneyTotals();
    await act(async () => { pending.resolve(json(summary("205.00", "25.00", "180.00"))); });
    await waitFor(() => assertAmount("Income", "205.00"));
    assertAmount("Expenses", "25.00"); assertAmount("Net Flow", "180.00");
    expect(panel()).not.toHaveTextContent(/114\.25|151\.50|37\.25/);
    assertSummaryRequestsBound();
  });

  it("rechecks peer visibility changes on refocus in two independent clients without displaying old totals", async () => {
    const first = independentClient(), peer = independentClient();
    mount(undefined, first); const other = peerSummary(peer);
    await waitFor(() => expect(summaryReads()).toHaveLength(2));
    await waitFor(() => assertAmount("Income", "114.25"));
    await waitFor(() => expect(other.result.current.data?.totalIncome.amount).toBe("114.25"));
    act(() => { focusManager.setFocused(false); });
    summaryReply = () => json(summary("40.00", "0.00", "40.00"));
    await act(async () => { await peer.invalidateQueries({ queryKey: transactionKeys.all }); });
    await waitFor(() => expect(other.result.current.data?.totalIncome.amount).toBe("40.00"));
    assertAmount("Income", "114.25");
    const pending = heldSummary(); summaryReply = () => pending.promise.then(response => response.clone());
    act(() => { focusManager.setFocused(true); });
    await waitFor(() => expect(summaryReads()).toHaveLength(5));
    expect(within(panel()).getByRole("status")).toHaveTextContent("Loading summary");
    assertNoMoneyTotals(); expect(other.result.current.data).toBeUndefined();
    await act(async () => { pending.resolve(json(summary("40.00", "0.00", "40.00"))); });
    await waitFor(() => assertAmount("Income", "40.00"));
    assertAmount("Expenses", "0.00"); assertAmount("Net Flow", "40.00");
    await waitFor(() => expect(other.result.current.data?.totalIncome.amount).toBe("40.00"));
    expect(panel()).not.toHaveTextContent(/114\.25|151\.50|37\.25/);
    assertSummaryRequestsBound();
  });
});