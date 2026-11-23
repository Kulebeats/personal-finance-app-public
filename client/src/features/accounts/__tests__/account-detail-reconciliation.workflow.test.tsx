/** @vitest-environment jsdom */
import { Suspense, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { Router as LocationRouter } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router as ProductionRouter } from "@/App";
import { SessionProvider } from "@/contexts/SessionContext";
import { SessionBoundary } from "@/components/session/SessionBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { clearCsrfToken, registerStepUpHandler, type Account } from "@/lib/api";
import { retireOperationLifetime } from "@/lib/operation-lifetime";

// Keep the registered route, account data hooks, menu, dialog, API client and
// actual session/settings/password-step-up providers. Only unrelated chrome,
// plotting and editors are replaced; every workflow result crosses fetch.
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/features/accounts/components/EditAccountModal", () => ({ EditAccountModal: () => null }));
vi.mock("@/components/accounts/ImportTransactionsModal", () => ({ ImportTransactionsModal: () => null }));
vi.mock("@/components/accounts/ImportBalanceHistoryModal", () => ({ ImportBalanceHistoryModal: () => null }));
vi.mock("recharts", () => ({ ResponsiveContainer: () => null, AreaChart: () => null, Area: () => null,
  XAxis: () => null, YAxis: () => null, Tooltip: () => null }));

const ids = { subject: "11111111-1111-4111-8111-111111111111", household: "22222222-2222-4222-8222-222222222222",
  account: "33333333-3333-4333-8333-333333333333", receipt: "44444444-4444-4444-8444-444444444444" };
const originalVersion = "2026-11-02T10:00:00.000Z", nextVersion = "2026-11-02T10:01:00.000Z";
const token = "a".repeat(64), nextToken = "b".repeat(64), password = "SyntheticReconcile123!";
const reason = "Statement checked against the card provider";
type Packet = { mode: "preview" | "apply"; targetBalance: { amount: string; currency: string }; expectedUpdatedAt: string;
  reason: string; idempotencyKey: string; previewToken?: string };
type ObservedRequest = { url: URL; method: string; headers: Headers; credentials: RequestCredentials | undefined; body: string };
let requests: ObservedRequest[], accountReads: Account[], account: Account;
let verified: boolean, role: "owner" | "view_only" | "professional";
let previewReply: (request: ObservedRequest) => Promise<Response>, applyReply: (request: ObservedRequest) => Promise<Response>;
const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "content-type": "application/json" } });
const failure = (status: number, code: string, message: string) => new Response(JSON.stringify({ success: false, error: { code, message } }),
  { status, headers: { "content-type": "application/json" } });
const money = (amount: string) => ({ amount, currency: "USD" });
const quote = (current = "110.00", adjustment = "-4.25") => ({ currentBalance: money(current), targetBalance: money("105.75"),
  adjustment: money(adjustment), postingDate: "2026-11-02" });
const packet = (request: ObservedRequest) => JSON.parse(request.body) as Packet;
const reconciliations = (mode?: Packet["mode"]) => requests.filter(request => request.url.pathname === `/api/accounts/${ids.account}/reconcile`
  && (!mode || packet(request).mode === mode));
const stepUps = () => requests.filter(request => request.url.pathname === "/api/settings/security/step-up");
const transactionReads = () => requests.filter(request => request.url.pathname === "/api/transactions" && request.method === "GET");
const editor = () => screen.getByRole("dialog", { name: "Reconcile balance" });
const button = (name: string) => within(editor()).getByRole("button", { name });

function mount() {
  const location = memoryLocation({ path: `/accounts/${ids.account}`, record: true });
  return render(<LocationRouter hook={location.hook} searchHook={location.searchHook}>
    <TooltipProvider><SessionProvider><SessionBoundary>
      <Suspense fallback={<p>Loading registered account route</p>}><ProductionRouter /></Suspense>
    </SessionBoundary></SessionProvider></TooltipProvider>
  </LocationRouter>);
}
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  await user.click(await screen.findByRole("menuitem", { name: "Reconcile balance" }));
  return screen.findByRole("dialog", { name: "Reconcile balance" });
}
async function enter(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(within(editor()).getByLabelText(/Statement balance/));
  await user.type(within(editor()).getByLabelText(/Statement balance/), "105.75");
  await user.clear(within(editor()).getByLabelText("Reason", { exact: true }));
  await user.type(within(editor()).getByLabelText("Reason", { exact: true }), reason);
}
async function ready() {
  await waitFor(() => expect(button("Apply adjustment")).toBeEnabled());
  expect(editor()).toHaveTextContent("USD 110.00");
  expect(editor()).toHaveTextContent("USD 105.75");
  expect(editor()).toHaveTextContent("USD -4.25");
  expect(editor()).toHaveTextContent("2026-11-02");
  expect(editor()).not.toHaveTextContent(/ZMW\s+(?:110|105|4)/);
}
async function close(user: ReturnType<typeof userEvent.setup>) {
  await user.click(button("Close"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Reconcile balance" })).not.toBeInTheDocument());
}
function assertBound(request: ObservedRequest) {
  expect(request.method).toBe("POST"); expect(request.credentials).toBe("include");
  expect(request.headers.get("X-Capital-Subject")).toBe(ids.subject);
  expect(request.headers.get("X-Capital-Household")).toBe(ids.household);
  expect(request.headers.get("x-csrf-token")).toBe("synthetic-reconcile-csrf");
}
function assertDraft(request: ObservedRequest) {
  assertBound(request);
  expect(packet(request)).toEqual({ mode: "preview", targetBalance: money("105.75"), expectedUpdatedAt: originalVersion, reason,
    idempotencyKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i) });
}
function deferred() {
  let resolve!: (value: Response) => void;
  return { promise: new Promise<Response>(done => { resolve = done; }), resolve: (value: Response) => resolve(value) };
}

beforeEach(() => {
  vi.clearAllMocks(); clearCsrfToken(); registerStepUpHandler(null); retireOperationLifetime(); onlineManager.setOnline(true);
  requests = []; accountReads = []; verified = false; role = "owner";
  account = { id: ids.account, householdId: ids.household, ownerUserId: ids.subject, name: "Synthetic USD credit card", type: "credit",
    balance: "110.00", initialBalance: "100.00", currency: "USD", isAsset: false, isPrivate: false, isHidden: false,
    isArchived: false, displayOrder: 0, createdAt: originalVersion, updatedAt: originalVersion };
  previewReply = async () => json({ ...quote(), previewToken: token });
  applyReply = async () => { account = { ...account, balance: "105.75", updatedAt: nextVersion }; return json({ ...quote(), transactionId: ids.receipt }); };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { url: new URL(String(input), "http://localhost"), method: (init?.method || "GET").toUpperCase(),
      headers: new Headers(init?.headers), credentials: init?.credentials, body: String(init?.body ?? "") };
    requests.push(request);
    const path = request.url.pathname;
    if (path === "/api/auth/session") return json({ state: "ready", subject: { id: ids.subject, email: "synthetic@example.invalid", displayName: "Synthetic" },
      household: { id: ids.household, role } });
    if (path === "/api/csrf-token") return new Response(JSON.stringify({ csrfToken: "synthetic-reconcile-csrf" }), { status: 200 });
    if (path === "/api/settings/display") return json({ settings: { userId: ids.subject, currency: "ZMW", theme: "light", timezone: "Africa/Lusaka",
      numberFormat: "US", dateFormat: "MM/DD/YYYY", firstDayOfWeek: "Sunday", viewMode: "comfortable" } });
    if (path === `/api/accounts/${ids.account}` && request.method === "GET") { accountReads.push({ ...account }); return json(account); }
    if (path === `/api/accounts/${ids.account}/balance-history` && request.method === "GET") return json([]);
    if (path === "/api/transactions" && request.method === "GET") return new Response(JSON.stringify({ success: true, data: [],
      pagination: { limit: 50, offset: 0, count: 0, totalCount: 0, total: 0, page: 1, pageSize: 0, hasNext: false, hasPrev: false } }), { status: 200 });
    if (path === "/api/settings/security/step-up" && request.method === "POST") {
      expect(JSON.parse(request.body)).toEqual({ password }); verified = true; return json({ verified: true });
    }
    if (path === `/api/accounts/${ids.account}/reconcile` && request.method === "POST") {
      if (!verified) return new Response(JSON.stringify({ success: false, error: { code: "STEP_UP_REQUIRED", message: "Confirm your password to reconcile" },
        requiresStepUp: true, level: "FINANCIAL" }), { status: 401 });
      return packet(request).mode === "preview" ? previewReply(request) : applyReply(request);
    }
    throw new Error(`Unexpected workflow request: ${request.method} ${path}`);
  }));
});
afterEach(() => { cleanup(); registerStepUpHandler(null); retireOperationLifetime(); clearCsrfToken(); onlineManager.setOnline(true); vi.unstubAllGlobals(); });

describe("R08 mounted registered account reconciliation workflow (UNIT, simulated HTTP)", () => {
  it("previews through password step-up, displays signed server USD values, then applies the exact reviewed packet once", async () => {
    const user = userEvent.setup(); mount(); await open(user); await enter(user); await user.click(button("Preview"));
    const authentication = await screen.findByRole("dialog", { name: "Confirm it's you" });
    expect(authentication).toHaveTextContent("This moves money");
    expect(reconciliations("preview")).toHaveLength(1); assertDraft(reconciliations("preview")[0]);
    expect(reconciliations("apply")).toEqual([]);
    await user.type(within(authentication).getByLabelText("Password", { exact: true }), password);
    await user.click(within(authentication).getByRole("button", { name: "Confirm" }));
    await ready();
    expect(stepUps()).toHaveLength(1); assertBound(stepUps()[0]);
    expect(reconciliations("preview")).toHaveLength(2);
    expect(reconciliations("preview")[1].body).toBe(reconciliations("preview")[0].body);
    const pending = deferred(); applyReply = () => pending.promise;
    const apply = button("Apply adjustment"); await user.click(apply); fireEvent.click(apply);
    await waitFor(() => expect(reconciliations("apply")).toHaveLength(1)); expect(apply).toBeDisabled();
    const submitted = reconciliations("apply")[0]; assertBound(submitted);
    expect(packet(submitted)).toEqual({ ...packet(reconciliations("preview")[0]), mode: "apply", previewToken: token });
    account = { ...account, balance: "105.75", updatedAt: nextVersion };
    await act(async () => { pending.resolve(json({ ...quote(), transactionId: ids.receipt })); });
    expect(await within(editor()).findByRole("status")).toHaveTextContent("Adjustment recorded");
    expect(editor()).toHaveTextContent(ids.receipt);
    await waitFor(() => expect(accountReads.at(-1)?.balance).toBe("105.75"));
    expect(reconciliations("apply")).toHaveLength(1);
  });

  it("cancels a ready preview without applying it and reopens an entry without its old authority", async () => {
    verified = true; const user = userEvent.setup(); mount(); await open(user); await enter(user); await user.click(button("Preview")); await ready();
    await close(user);
    expect(reconciliations("apply")).toEqual([]);
    await open(user);
    expect(button("Preview")).toBeInTheDocument();
    expect(within(editor()).queryByRole("button", { name: "Apply adjustment" })).not.toBeInTheDocument();
    expect(editor()).not.toHaveTextContent("USD -4.25");
    expect(stepUps()).toEqual([]);
  });

  it("canceling password step-up sends no verification, preview retry or adjustment", async () => {
    const user = userEvent.setup(); mount(); await open(user); await enter(user); await user.click(button("Preview"));
    const authentication = await screen.findByRole("dialog", { name: "Confirm it's you" });
    await user.click(within(authentication).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Confirm it's you" })).not.toBeInTheDocument());
    expect(await within(editor()).findByRole("alert")).toHaveTextContent("Confirm your password");
    expect(reconciliations("preview")).toHaveLength(1); expect(reconciliations("apply")).toEqual([]); expect(stepUps()).toEqual([]);
  });

  it.each(["recorded receipt after archive", "stale conflict"] as const)("refreshes an unknown apply and retries the identical packet for %s", async outcome => {
    verified = true; const user = userEvent.setup(); mount(); await open(user); await enter(user); await user.click(button("Preview")); await ready();
    const readsBefore = accountReads.length, transactionsBefore = transactionReads().length;
    applyReply = async () => {
      account = { ...account, balance: "120.00", updatedAt: nextVersion, isArchived: outcome === "recorded receipt after archive" };
      throw new TypeError("Response lost after request reached server");
    };
    await user.click(button("Apply adjustment"));
    await waitFor(() => expect(button("Retry same adjustment")).toBeEnabled());
    expect(await within(editor()).findByRole("alert")).toHaveTextContent(/could not be confirmed/i);
    const first = reconciliations("apply")[0]; assertBound(first);
    await waitFor(() => { expect(accountReads.length).toBeGreaterThan(readsBefore); expect(transactionReads().length).toBeGreaterThan(transactionsBefore); });
    expect(accountReads.at(-1)).toMatchObject({ balance: "120.00", updatedAt: nextVersion, isArchived: outcome === "recorded receipt after archive" });
    await close(user); await open(user); expect(button("Retry same adjustment")).toBeEnabled();
    applyReply = async () => outcome === "stale conflict" ? failure(409, "CONFLICT", "Preview is stale") : json({ ...quote(), transactionId: ids.receipt });
    await user.click(button("Retry same adjustment"));
    await waitFor(() => expect(reconciliations("apply")).toHaveLength(2));
    expect(reconciliations("apply")[1].body).toBe(first.body); assertBound(reconciliations("apply")[1]);
    expect(reconciliations("preview")).toHaveLength(1);
    if (outcome === "recorded receipt after archive") {
      expect(await within(editor()).findByRole("status")).toHaveTextContent("Adjustment recorded"); expect(editor()).toHaveTextContent(ids.receipt);
      expect(accountReads.at(-1)?.balance).toBe("120.00");
    } else {
      await waitFor(() => expect(button("Preview")).toBeEnabled());
      expect(within(editor()).getByRole("alert")).toHaveTextContent(/earlier adjustment could not be confirmed/i);
      previewReply = async () => json({ ...quote("120.00", "-14.25"), previewToken: nextToken });
      await user.click(button("Preview"));
      await waitFor(() => expect(reconciliations("preview")).toHaveLength(2));
      const renewed = packet(reconciliations("preview")[1]);
      expect(renewed).toMatchObject({ expectedUpdatedAt: nextVersion, targetBalance: money("105.75"), reason });
      expect(renewed.idempotencyKey).not.toBe(packet(first).idempotencyKey);
      await waitFor(() => expect(button("Apply adjustment")).toBeEnabled()); expect(editor()).toHaveTextContent("USD -14.25");
      expect(reconciliations("apply")).toHaveLength(2);
    }
  });

  it.each(["view_only", "professional", "different household"] as const)("withholds the menu action for %s", async denied => {
    if (denied === "different household") account = { ...account, householdId: "55555555-5555-4555-8555-555555555555" };
    else role = denied;
    const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("menuitem", { name: "Reconcile balance" })).not.toBeInTheDocument();
    expect(reconciliations()).toEqual([]);
  });
});
