import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Holding } from "@/hooks/useInvestments";
import { useDeleteHolding } from "@/hooks/investments/useHoldings";
import { investmentKeys } from "@/hooks/investments/keys";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import Investments from "@/pages/Investments";

type Role = "owner" | "admin" | "member" | "professional" | "view_only";
const mocks = vi.hoisted(() => ({ api: vi.fn(), remove: vi.fn(), toast: vi.fn(), globalError: vi.fn(),
  operation: null as OperationLifetime | null, client: null as QueryClient | null, role: "member" as Role, rows: [] as Holding[] }));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: mocks.operation?.expectations?.subject }, household: { id: mocks.operation?.expectations?.household, role: mocks.role } },
  lifetime: { operation: mocks.operation, client: mocks.client },
}) }));
vi.mock("@/hooks/use-settings", () => ({ useDisplaySettings: () => ({ data: { currency: "ZMW", numberFormat: "US" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.globalError } }));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [] }) }));
vi.mock("@/lib/queryClient", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/queryClient")>(), apiRequest: mocks.api }));
vi.mock("@/hooks/useInvestments", async importOriginal => ({
  ...await importOriginal<typeof import("@/hooks/useInvestments")>(),
  useSecurities: () => ({ data: [], isLoading: false }), useInvestmentPerformance: () => ({ data: [] }),
}));
vi.mock("../components/GRZSecurities", () => ({ GRZSecurities: () => null }));
vi.mock("../components/FXImpactPanel", () => ({ FXImpactPanel: () => null }));
vi.mock("../components/TaxReport", () => ({ TaxReport: () => null }));
vi.mock("../components/PensionDashboard", () => ({ PensionDashboard: () => null }));
vi.mock("../components/RecurringInvestmentSetup", () => ({ RecurringInvestmentSetup: () => null }));
vi.mock("../components/InvestmentPerformance", () => ({ InvestmentPerformance: () => null }));
vi.mock("../components/InvestmentAllocation", () => ({ InvestmentAllocation: () => null }));

const shellId = "11111111-1111-4111-8111-111111111111", otherId = "22222222-2222-4222-8222-222222222222";
const shell: Holding = { id: shellId, householdId: "household", accountId: "custody", securityId: "security", quantity: "0.00000000",
  costBasis: "0.00", costBasisZmw: null, acquiredDate: null, acquisitionFxRate: null, createdAt: "", updatedAt: "", currentValue: { amount: "0.00", currency: "ZMW" }, gainLossPercent: 0,
  security: { id: "security", symbol: "SHELL", name: "Synthetic zero-share holding", type: "stock", currency: "USD", currentPrice: "0.10",
    exchange: null, isOffshore: false, sector: null, cusipIsin: null, lastPriceUpdate: null, withholdingTaxRate: "0", createdAt: "", updatedAt: "" } };
const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "content-type": "application/json" } });
const failure = (status: number, message: string) => Object.assign(new Error(message), { status, code: status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : "INTERNAL_ERROR" });
let clients: QueryClient[];
function scope(household = "household") {
  if (mocks.operation) retireOperationLifetime(mocks.operation);
  if (mocks.client) retireDataClient(mocks.client);
  mocks.operation = createOperationLifetime({ subject: "subject", household }); activateOperationLifetime(mocks.operation);
  mocks.client = createDataQueryClient(undefined, mocks.operation); clients.push(mocks.client);
  return mocks.client;
}
beforeEach(() => {
  vi.clearAllMocks(); clients = []; mocks.operation = null; mocks.client = null; mocks.role = "member"; mocks.rows = [{ ...shell }]; scope();
  mocks.remove.mockReset().mockImplementation(async (id: string) => { mocks.rows = mocks.rows.filter(row => row.id !== id); return new Response(null, { status: 204 }); });
  mocks.api.mockImplementation(async (method: string, path: string) => {
    if (method === "GET" && path.startsWith("/api/investments/holdings")) return json(mocks.rows.map(row => ({ ...row })));
    if (method === "GET" && path.startsWith("/api/investments/portfolio/summary")) return json({ totalValue: { amount: "0.00", currency: "ZMW" }, totalCostBasis: { amount: "0.00", currency: "ZMW" },
      totalGainLoss: { amount: "0.00", currency: "ZMW" }, totalGainLossPercent: 0 });
    if (method === "DELETE" && path.startsWith("/api/investments/holdings/")) return mocks.remove(path.split("/").pop());
    throw new Error(`Unexpected test transport: ${method} ${path}`);
  });
});
afterEach(() => { cleanup(); clients.forEach(retireDataClient); retireOperationLifetime(mocks.operation); });
const tree = () => <QueryClientProvider client={mocks.client!}><Investments /></QueryClientProvider>;
async function page() {
  const rendered = render(tree()), user = userEvent.setup();
  await screen.findByRole("cell", { name: /SHELL/ });
  return { rendered, user };
}
async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Review removal of SHELL" }));
  return within(screen.getByRole("alertdialog"));
}
const successes = () => mocks.toast.mock.calls.filter(([notice]) => notice.title === "Holding Removed");

it("accepts an actual empty204 without parsing JSON and passes the captured lifetime to DELETE", async () => {
  const response = new Response(null, { status: 204 }), parse = vi.spyOn(response, "json"); mocks.remove.mockResolvedValueOnce(response);
  const { result } = renderHook(() => useDeleteHolding(), { wrapper: ({ children }) => <QueryClientProvider client={mocks.client!}>{children}</QueryClientProvider> });
  await act(async () => { await expect(result.current.mutateAsync(shellId)).resolves.toBeUndefined(); });
  expect(parse).not.toHaveBeenCalled();
  expect(mocks.api).toHaveBeenCalledWith("DELETE", `/api/investments/holdings/${shellId}`, undefined, mocks.operation);
  expect(successes()).toHaveLength(1);
});

it("cancels pending first list/detail/summary reads and refreshes active observers after acknowledgement", async () => {
  const counts = [0, 0, 0], release: Array<(value: string) => void> = [];
  const keys = [investmentKeys.holdings("ZMW"), [...investmentKeys.holdingsRoot(), "detail", shellId], investmentKeys.portfolioSummary("ZMW")];
  function useReads() {
    const list = useQuery({ queryKey: keys[0], queryFn: () => ++counts[0] === 1 ? new Promise<string>(done => { release[0] = done; }) : "fresh-list" });
    const detail = useQuery({ queryKey: keys[1], queryFn: () => ++counts[1] === 1 ? new Promise<string>(done => { release[1] = done; }) : "fresh-detail" });
    const summary = useQuery({ queryKey: keys[2], queryFn: () => ++counts[2] === 1 ? new Promise<string>(done => { release[2] = done; }) : "fresh-summary" });
    return { list, detail, summary, remove: useDeleteHolding() };
  }
  const { result } = renderHook(useReads, { wrapper: ({ children }) => <QueryClientProvider client={mocks.client!}>{children}</QueryClientProvider> });
  await waitFor(() => expect(release.filter(Boolean)).toHaveLength(3));
  let outcome!: Promise<unknown>;
  act(() => { outcome = result.current.remove.mutateAsync(shellId).catch(error => error); });
  try {
    await waitFor(() => expect(counts.every(count => count >= 2)).toBe(true));
    await act(async () => { release.forEach(done => done("retired-first-read")); await outcome; });
    expect([result.current.list.data, result.current.detail.data, result.current.summary.data]).toEqual(["fresh-list", "fresh-detail", "fresh-summary"]);
  } finally { release.forEach(done => done("retired-first-read")); }
});

it("does not continue cache invalidation or toast after identity retires during acknowledgement refresh", async () => {
  const old = mocks.client!, originalCancel = old.cancelQueries.bind(old); let acknowledged = false, unblock!: () => void, blocked = false;
  mocks.remove.mockImplementationOnce(async () => { acknowledged = true; return new Response(null, { status: 204 }); });
  vi.spyOn(old, "cancelQueries").mockImplementation((...args) => {
    if (acknowledged && !blocked) { blocked = true; return new Promise<void>(done => { unblock = done; }); }
    return originalCancel(...args);
  });
  const invalidate = vi.spyOn(old, "invalidateQueries");
  const { result } = renderHook(() => useDeleteHolding(), { wrapper: ({ children }) => <QueryClientProvider client={old}>{children}</QueryClientProvider> });
  let outcome!: Promise<unknown>;
  act(() => { outcome = result.current.mutateAsync(shellId).catch(error => error); });
  await waitFor(() => expect(blocked).toBe(true));
  retireOperationLifetime(mocks.operation); scope("other-household"); mocks.toast.mockClear(); mocks.globalError.mockClear(); invalidate.mockClear();
  await act(async () => { unblock(); await outcome; });
  expect(invalidate).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled(); expect(mocks.globalError).not.toHaveBeenCalled();
});

it("does not strand an initial read when removal has no acknowledgement", async () => {
  let finishRead!: (value: string) => void;
  mocks.remove.mockRejectedValueOnce(new TypeError("Response lost"));
  const { result } = renderHook(() => ({
    read: useQuery({ queryKey: investmentKeys.holdings("ZMW"), queryFn: () => new Promise<string>(done => { finishRead = done; }) }),
    remove: useDeleteHolding(),
  }), { wrapper: ({ children }) => <QueryClientProvider client={mocks.client!}>{children}</QueryClientProvider> });
  await waitFor(() => expect(finishRead).toBeTypeOf("function"));
  await act(async () => { await result.current.remove.mutateAsync(shellId).catch(() => {}); finishRead("visible-existing-holdings"); });
  await waitFor(() => expect(result.current.read.data).toBe("visible-existing-holdings"));
  expect(successes()).toHaveLength(0);
});

it("offers actual zero-row review, confirms removal and refreshes the real page after204", async () => {
  const { user } = await page(), dialog = await review(user);
  expect(dialog.getByText(/server will check/i)).toBeVisible();
  await user.click(dialog.getByRole("button", { name: "Remove holding" }));
  await screen.findByRole("heading", { name: "No Holdings Yet" });
  expect(screen.queryByRole("alertdialog")).toBeNull(); expect(successes()).toHaveLength(1); expect(mocks.remove).toHaveBeenCalledWith(shellId);
});

it("never derives removal eligibility from rounded converted cost or a positive quantity that displays as zero", async () => {
  mocks.rows = [{ ...shell, costBasis: "123.45" }, { ...shell, id: otherId, quantity: "0.00000001", costBasis: "0.00", security: { ...shell.security!, symbol: "TINY" } }];
  mocks.remove.mockRejectedValueOnce(failure(409, "Posted investment history requires disposal or reviewed correction."));
  const { user } = await page();
  expect(within(screen.getByRole("row", { name: /TINY/ })).queryByRole("button", { name: /removal/i })).toBeNull();
  const dialog = await review(user);
  await user.click(dialog.getByRole("button", { name: "Remove holding" }));
  expect(await dialog.findByText("Posted investment history requires disposal or reviewed correction.")).toBeVisible();
  expect(successes()).toHaveLength(0); expect(mocks.rows).toHaveLength(2);
});

it.each(["professional", "view_only"] as const)("offers no row write control to %s", async role => {
  mocks.role = role; await page();
  const row = within(screen.getByRole("row", { name: /SHELL/ }));
  expect(row.queryByRole("button", { name: /removal|Record/i })).toBeNull();
});

it("holds one synchronous removal claim while pending and prevents duplicate confirmation", async () => {
  let finish!: (response: Response) => void;
  mocks.remove.mockImplementationOnce(() => new Promise<Response>(done => { finish = done; }));
  const { user } = await page(), dialog = await review(user);
  await user.dblClick(dialog.getByRole("button", { name: "Remove holding" }));
  expect(mocks.remove).toHaveBeenCalledTimes(1); expect(dialog.getByRole("button", { name: /Removing/ })).toBeDisabled();
  expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await act(async () => { mocks.rows = []; finish(new Response(null, { status: 204 })); });
  await screen.findByRole("heading", { name: "No Holdings Yet" }); expect(successes()).toHaveLength(1);
});

it("keeps the same resource target after lost acknowledgement, row removal, close and exact retry", async () => {
  mocks.remove.mockImplementationOnce(async () => { mocks.rows = []; throw new TypeError("Response lost"); });
  const { user } = await page(), dialog = await review(user);
  await user.click(dialog.getByRole("button", { name: "Remove holding" }));
  expect(await dialog.findByText(/removal was not confirmed/i)).toBeVisible();
  await act(async () => { await mocks.client!.invalidateQueries({ queryKey: investmentKeys.holdingsRoot() }); });
  expect(screen.getByRole("alertdialog")).toBeVisible();
  await user.click(dialog.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Review removal" }));
  const resumed = within(screen.getByRole("alertdialog"));
  expect(resumed.getByText(/SHELL/)).toBeVisible();
  await user.click(resumed.getByRole("button", { name: "Retry removal" }));
  expect(mocks.remove.mock.calls.map(([id]) => id)).toEqual([shellId, shellId]);
  expect(successes()).toHaveLength(1);
});

it.each([404, 409])("keeps a server%d refusal visible without claiming deletion", async status => {
  const message = status === 404 ? "Holding not found" : "Holding has posted history";
  mocks.remove.mockRejectedValueOnce(failure(status, message));
  const { user } = await page(), dialog = await review(user);
  await user.click(dialog.getByRole("button", { name: "Remove holding" }));
  expect(await dialog.findByText(message)).toBeVisible(); expect(successes()).toHaveLength(0);
  expect(dialog.queryByRole("button", { name: "Remove holding" })).toBeNull();
});

it.each([
  [202, '{"pending":true}', "application/json"],
  [200, '{"success":true,"data":{}}', "application/json"],
  [200, "<html><body>Sign in</body></html>", "text/html"],
] as const)("retains the exact target after an unexpected%d %s response until a real204 replay", async (status, body, contentType) => {
  mocks.rows = [{ ...shell }, { ...shell, id: otherId, security: { ...shell.security!, symbol: "OTHER" } }];
  const response = new Response(body, { status, headers: { "content-type": contentType } });
  const parse = vi.spyOn(response, "json"); mocks.remove.mockResolvedValueOnce(response);
  const { user } = await page(), dialog = await review(user);
  await user.click(dialog.getByRole("button", { name: "Remove holding" }));
  expect(await dialog.findByText(/removal was not confirmed/i)).toBeVisible();
  expect(successes()).toHaveLength(0); expect(parse).not.toHaveBeenCalled();
  await user.click(dialog.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "Review removal of OTHER" }));
  const resumed = within(screen.getByRole("alertdialog"));
  expect(resumed.getByText(/Review removal of SHELL/)).toBeVisible();
  expect(resumed.queryByText(/Review removal of OTHER/)).toBeNull();
  await user.click(resumed.getByRole("button", { name: "Retry removal" }));
  expect(mocks.remove.mock.calls.map(([id]) => id)).toEqual([shellId, shellId]);
  expect(successes()).toHaveLength(1); expect(screen.getByRole("cell", { name: /OTHER/ })).toBeVisible();
});

it.each([
  [400, "Invalid holding identifier"],
  [401, "Authentication required"],
  [403, "Financial write access required"],
] as const)("shows an authoritative%d refusal and lets Close clear it before reviewing another holding", async (status, message) => {
  mocks.rows = [{ ...shell }, { ...shell, id: otherId, security: { ...shell.security!, symbol: "OTHER" } }];
  mocks.remove.mockRejectedValueOnce(failure(status, message));
  const { user } = await page(), dialog = await review(user);
  await user.click(dialog.getByRole("button", { name: "Remove holding" }));
  expect(await dialog.findByText(message)).toBeVisible(); expect(successes()).toHaveLength(0);
  expect(dialog.queryByText(/removal was not confirmed/i)).toBeNull();
  expect(dialog.queryByRole("button", { name: "Retry removal" })).toBeNull();
  await user.click(dialog.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("button", { name: "Review removal" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Review removal of OTHER" }));
  const next = within(screen.getByRole("alertdialog"));
  expect(next.getByText(/Review removal of OTHER/)).toBeVisible();
  expect(next.queryByText(message)).toBeNull();
  await user.click(next.getByRole("button", { name: "Remove holding" }));
  expect(mocks.remove.mock.calls.map(([id]) => id)).toEqual([shellId, otherId]);
  expect(successes()).toHaveLength(1); expect(screen.getByRole("cell", { name: /SHELL/ })).toBeVisible();
});

it("keeps an auditfailure500 outcome unconfirmed and retries exactly the same target", async () => {
  mocks.remove.mockRejectedValueOnce(failure(500, "An internal error occurred. Please try again."));
  const { user } = await page(), dialog = await review(user);
  await user.click(dialog.getByRole("button", { name: "Remove holding" }));
  expect(await dialog.findByText(/removal was not confirmed/i)).toBeVisible();
  expect(successes()).toHaveLength(0);
  await user.click(dialog.getByRole("button", { name: "Retry removal" }));
  expect(mocks.remove.mock.calls.map(([id]) => id)).toEqual([shellId, shellId]); expect(successes()).toHaveLength(1);
});

it("does not mutate the new household's cache, form or toast after an old removal completes", async () => {
  let finish!: (response: Response) => void;
  mocks.remove.mockImplementationOnce(() => new Promise<Response>(done => { finish = done; }));
  const { user, rendered } = await page(), dialog = await review(user);
  await user.click(dialog.getByRole("button", { name: "Remove holding" }));
  scope("other-household"); mocks.rows = [{ ...shell, id: otherId, security: { ...shell.security!, symbol: "OTHER" } }];
  rendered.rerender(tree()); await screen.findByRole("cell", { name: /OTHER/ });
  mocks.toast.mockClear(); mocks.globalError.mockClear();
  await act(async () => finish(new Response(null, { status: 204 })));
  expect(screen.queryByRole("alertdialog")).toBeNull(); expect(screen.getByRole("cell", { name: /OTHER/ })).toBeVisible();
  expect(mocks.client!.getQueryData(investmentKeys.holdings("ZMW"))).toMatchObject({ data: [{ id: otherId }] });
  expect(mocks.toast).not.toHaveBeenCalled(); expect(mocks.globalError).not.toHaveBeenCalled();
});
