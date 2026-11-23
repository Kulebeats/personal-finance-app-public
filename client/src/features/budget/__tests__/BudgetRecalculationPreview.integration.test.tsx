import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager, QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MoneyDto } from "@shared/money";
import type { SessionStatus } from "@shared/session-status";
import type { BudgetWithProgress, BudgetForecastData } from "@/hooks/useBudgets";
import Budget from "@/pages/Budget";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { clearCsrfToken } from "@/lib/csrf";

const ids = { subject: "11111111-1111-4111-8111-111111111111", household: "22222222-2222-4222-8222-222222222222",
  category: "33333333-3333-4333-8333-333333333333", group: "44444444-4444-4444-8444-444444444444", budget: "55555555-5555-4555-8555-555555555555" };
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn(), settings: vi.fn(), clear: vi.fn(), create: vi.fn(), update: vi.fn(), forecast: vi.fn(), move: vi.fn(),
  subject: "", household: "", operation: null as OperationLifetime | null, client: null as QueryClient | null, ready: true,
  lifetime: null as { key: string; operation: OperationLifetime; client: QueryClient } | null, status: null as SessionStatus | null,
  settingsData: { budgetSystem: "category" as const, defaultApplyScope: "this_month" as const },
  budgets: [] as BudgetWithProgress[], forecastData: undefined as BudgetForecastData | undefined,
  categories: [] as Record<string, unknown>[], groups: [] as Record<string, unknown>[] }));
vi.mock("wouter", () => ({ useLocation: () => ["/budget", vi.fn()] }));
vi.mock("@/components/Layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/contexts/SettingsContext", () => ({ useFormatters: () => ({ currency: "ZMW", formatCurrency: (value: number) => `ZMW ${value.toFixed(2)}` }) }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ loading: !mocks.ready,
  status: mocks.ready ? mocks.status : null, lifetime: mocks.ready ? mocks.lifetime : null }) }));
vi.mock("@/hooks/useBudgets", async original => {
  const actual = await original<typeof import("@/hooks/useBudgets")>();
  return { ...actual,
    useBudgetProgress: () => ({ data: mocks.budgets, isLoading: false, error: null }),
    useBudgetSettings: () => ({ data: mocks.settingsData }),
    useUpdateBudgetSettings: () => ({ mutate: mocks.settings, isPending: false }),
    useClearBudgets: () => ({ mutate: mocks.clear, isPending: false }),
    useCreateBudget: () => ({ mutate: mocks.create, isPending: false }),
    useUpdateBudget: () => ({ mutate: mocks.update, isPending: false }),
    useBudgetForecast: () => ({ data: mocks.forecastData, isLoading: false }),
    useUpdateBudgetForecast: () => ({ mutate: mocks.forecast, isPending: false }),
    useMoveBudgetAmount: () => ({ mutate: mocks.move, isPending: false }),
    // Retain the real legacy hook: a stale caller's POST must be observed.
  };
});
vi.mock("@/hooks/use-settings", () => ({ useCategories: () => ({ data: { categories: mocks.categories, groups: mocks.groups }, isLoading: false }),
  useHousehold: () => ({ data: { household: { currency: "ZMW" }, preferences: null } }) }));
vi.mock("@/hooks/useGoals", () => ({ useGoals: () => ({ data: undefined }) }));

interface Preview {
  mode: "preview"; scope: "visible_posted_activity"; targetPeriod: string; periods: string[];
  suggestions: { categoryId: string | null; categoryGroupId: string | null; historicalTotal: MoneyDto; amount: MoneyDto; currentBudget: { id: string; amount: MoneyDto; periodId: string | null; periodVersion: number | null } | null }[];
}
type ObservedRequest = { url: URL; method: string; headers: Headers; credentials: RequestCredentials | undefined; body?: BodyInit | null; cache?: RequestCache };
let requests: ObservedRequest[] = [], clients: QueryClient[] = [];
let reply: () => Promise<Response>;
let applyReply: (request: ObservedRequest) => Promise<Response>;
function preview(amount = "183.33", currency = "ZMW"): Preview {
  return { mode: "preview", scope: "visible_posted_activity", targetPeriod: "2026-11", periods: ["2026-08", "2026-09", "2026-10"],
    suggestions: [{ categoryId: ids.category, categoryGroupId: null, historicalTotal: { amount: "550.00", currency }, amount: { amount, currency },
      currentBudget: { id: ids.budget, amount: { amount: "500.00", currency }, periodId: null, periodVersion: null } }] };
}
const response = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "content-type": "application/json" } });
const failure = (status: number, message: string) => new Response(JSON.stringify({ success: false, error: { code: status === 404 ? "NOT_FOUND" : "MISSING_FX_RATE", message } }), { status, headers: { "content-type": "application/json" } });
function deferred() { let resolve!: (value: Response) => void; return { promise: new Promise<Response>(done => { resolve = done; }), resolve: (value: Response) => resolve(value) }; }
function setLifetime(subject: string, household: string) {
  retireOperationLifetime(mocks.operation); if (mocks.client) retireDataClient(mocks.client);
  mocks.subject = subject; mocks.household = household; mocks.ready = true;
  mocks.operation = createOperationLifetime({ subject, household }); activateOperationLifetime(mocks.operation);
  mocks.client = createDataQueryClient(undefined, mocks.operation); clients.push(mocks.client);
  mocks.lifetime = { key: `${subject}:${household}`, operation: mocks.operation, client: mocks.client };
  mocks.status = { state: "ready", subject: { id: subject, email: "synthetic@example.invalid", displayName: "Synthetic" }, household: { id: household, role: "member" } };
}
function tree() { return <QueryClientProvider client={mocks.client!}><Budget /></QueryClientProvider>; }
function mount() { return render(tree()); }
function previewRequests() { return requests.filter(request => request.url.pathname === "/api/budgets/recalculate/preview"); }
function applyRequests() { return requests.filter(request => request.url.pathname === "/api/budgets/recalculate/apply"); }
const submitted = (request: ObservedRequest) => JSON.parse(String(request.body)) as { operationId: string; months: number; targetPeriod: string; suggestions: Preview["suggestions"] };
function unchanged() {
  expect(screen.getByLabelText("Budget amount for Dining")).toHaveValue("500");
  expect(requests.filter(request => request.url.pathname.startsWith("/api/budgets") && request.method !== "GET")).toEqual([]);
  for (const mutation of [mocks.create, mocks.update, mocks.forecast, mocks.move, mocks.clear, mocks.settings]) expect(mutation).not.toHaveBeenCalled();
}
async function openSettings() { fireEvent.click(screen.getByRole("button", { name: "Settings" })); await screen.findByText("Budget Settings"); }
function trigger() { return screen.getByRole("button", { name: /^(?:Recalculate|Preview averages)$/i }); }
async function openPreview() { await openSettings(); fireEvent.click(trigger()); }
const dialog = () => screen.getByRole("dialog", { name: "Budget suggestions" });
async function ready(amount = "183.33") { return within(await screen.findByRole("dialog", { name: "Budget suggestions" })).findAllByText(new RegExp(amount.replace(".", "\\."))); }
async function closePreview() {
  fireEvent.click(within(dialog()).getAllByRole("button", { name: /close|cancel/i })[0]);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Budget suggestions" })).not.toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks(); requests = []; clients = []; clearCsrfToken(); onlineManager.setOnline(true);
  mocks.forecastData = undefined;
  mocks.budgets = [{ id: ids.budget, householdId: ids.household, name: "Dining", categoryId: ids.category, categoryGroupId: null,
    amount: { amount: "500.00", currency: "ZMW" }, period: "monthly", rolloverEnabled: false, isActive: true, isFlexBucket: false,
    createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", spent: { amount: "0.00", currency: "ZMW" }, remaining: { amount: "500.00", currency: "ZMW" }, percentUsed: 0 }];
  mocks.categories = [{ id: ids.category, householdId: ids.household, groupId: ids.group, name: "Dining", includeInBudget: true, isArchived: false, displayOrder: 0 }];
  mocks.groups = [{ id: ids.group, householdId: ids.household, name: "Food", type: "expense", budgetMode: "by_category", isArchived: false, displayOrder: 0 }];
  setLifetime(ids.subject, ids.household); reply = async () => response(preview());
  applyReply = async request => { const body = submitted(request); return response({ operationId: body.operationId, targetPeriod: body.targetPeriod, appliedCount: body.suggestions.length }); };
  mocks.fetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const request = { url: new URL(String(input), "http://localhost"), method: (init?.method || "GET").toUpperCase(), headers: new Headers(init?.headers), credentials: init?.credentials, body: init?.body, cache: init?.cache };
    requests.push(request);
    if (request.url.pathname === "/api/csrf-token") return Promise.resolve(new Response(JSON.stringify({ csrfToken: "unused-preview-token" }), { status: 200 }));
    if (request.url.pathname === "/api/budgets/recalculate/preview" && request.method === "GET") return reply();
    if (request.url.pathname === "/api/budgets/recalculate/apply" && request.method === "POST") return applyReply(request);
    if (request.url.pathname === "/api/budgets/progress" && request.method === "GET") return Promise.resolve(response(mocks.budgets));
    return Promise.resolve(failure(404, "Unexpected endpoint: preview must never write"));
  });
  vi.stubGlobal("fetch", mocks.fetch); vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("FIN-07 months without a limit remain unbudgeted on the original page", () => {
  it("does not resurrect a category default when progress has no effective monthly limit", async () => {
    mocks.budgets = []; mocks.categories[0].budget = 999;
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Show 1 unbudgeted" }));
    const amount = await screen.findByLabelText("Budget amount for Dining");
    expect(amount).toHaveValue(""); expect(amount).toHaveAttribute("placeholder", "Unbudgeted");
    expect(screen.queryByText(/999\.00|NaN/)).not.toBeInTheDocument();
    fireEvent.blur(amount); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });

  it("shows an absent forecast period as unbudgeted beside an exact-currency limit and opens a blank edit", async () => {
    mocks.forecastData = { range: [{ year: 2027, month: 1 }, { year: 2027, month: 2 }],
      budgets: [{ ...mocks.budgets[0], amount: null, periods: [{ year: 2027, month: 1, amount: { amount: "183.33", currency: "USD" } }, { year: 2027, month: 2, amount: null }] }] };
    mount(); fireEvent.click(screen.getByRole("button", { name: "Forecast" }));
    expect(await screen.findByRole("button", { name: "USD 183.33" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unbudgeted" }));
    expect(await screen.findByText("Edit Forecast")).toBeInTheDocument();
    expect(screen.getByLabelText("Budget Amount")).toHaveValue(null);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument(); expect(mocks.forecast).not.toHaveBeenCalled();
  });

  it("preserves a displayed USD period denomination and exact entered amount when saving despite ZMW display settings", async () => {
    mocks.forecastData = { range: [{ year: 2027, month: 1 }], budgets: [{ ...mocks.budgets[0], amount: null,
      periods: [{ year: 2027, month: 1, amount: { amount: "183.33", currency: "USD" } }] }] };
    mount(); fireEvent.click(screen.getByRole("button", { name: "Forecast" }));
    fireEvent.click(await screen.findByRole("button", { name: "USD 183.33" }));
    fireEvent.change(screen.getByLabelText("Budget Amount"), { target: { value: "211.45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.forecast).toHaveBeenCalledWith({ id: ids.budget, data: { year: 2027, month: 1,
      amount: { amount: "211.45", currency: "USD" }, applyScope: "this_month", months: undefined } }, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it("uses verified target budget currency for a new absent forecast cell instead of the display preference", async () => {
    mocks.forecastData = { range: [{ year: 2027, month: 1 }, { year: 2027, month: 2 }], budgets: [Object.assign({ ...mocks.budgets[0], amount: null,
      periods: [{ year: 2027, month: 1, amount: { amount: "183.33", currency: "USD" } }, { year: 2027, month: 2, amount: null }] }, { currency: "USD" })] };
    mount(); fireEvent.click(screen.getByRole("button", { name: "Forecast" }));
    fireEvent.click(await screen.findByRole("button", { name: "Unbudgeted" }));
    fireEvent.change(screen.getByLabelText("Budget Amount"), { target: { value: "211.45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.forecast).toHaveBeenCalledWith({ id: ids.budget, data: { year: 2027, month: 2,
      amount: { amount: "211.45", currency: "USD" }, applyScope: "this_month", months: undefined } }, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it("requires explicit currency selection for a new forecast limit when its denomination is unavailable", async () => {
    mocks.forecastData = { range: [{ year: 2027, month: 1 }, { year: 2027, month: 2 }], budgets: [{ ...mocks.budgets[0], amount: null,
      periods: [{ year: 2027, month: 1, amount: { amount: "183.33", currency: "USD" } }, { year: 2027, month: 2, amount: null }] }] };
    mount(); fireEvent.click(screen.getByRole("button", { name: "Forecast" }));
    fireEvent.click(await screen.findByRole("button", { name: "Unbudgeted" }));
    fireEvent.change(screen.getByLabelText("Budget Amount"), { target: { value: "211.45" } });
    expect(screen.getByLabelText("Currency")).toHaveValue(""); expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(mocks.forecast).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.forecast).toHaveBeenCalledWith({ id: ids.budget, data: { year: 2027, month: 2,
      amount: { amount: "211.45", currency: "USD" }, applyScope: "this_month", months: undefined } }, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });
});

describe("FIN-07 individually selected and explicitly confirmed budget changes", () => {
  const reviewButton = () => within(dialog()).getByRole("button", { name: "Review selected changes" });
  const confirmButton = () => within(dialog()).getByRole("button", { name: "Confirm changes for November 2026" });
  async function reviewDining() {
    fireEvent.click(within(dialog()).getByRole("checkbox", { name: "Select Dining" }));
    fireEvent.click(reviewButton());
    await within(dialog()).findByRole("heading", { name: "Confirm budget changes" });
  }

  it("starts with no selected rows and requires a separate target-month confirmation", async () => {
    mount(); await openPreview(); await ready();
    expect(within(dialog()).getByRole("checkbox", { name: "Select Dining" })).not.toBeChecked();
    expect(reviewButton()).toBeDisabled();
    await reviewDining();
    const confirmation = within(dialog()).getByRole("region", { name: "Confirm budget changes" });
    expect(confirmation).toHaveTextContent("Dining"); expect(confirmation).toHaveTextContent("ZMW 500.00 → ZMW 183.33");
    expect(confirmation).toHaveTextContent(/only.*November 2026/i);
    unchanged();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Back to suggestions" }));
    expect(within(dialog()).queryByRole("region", { name: "Confirm budget changes" })).not.toBeInTheDocument(); unchanged();
  });

  it("posts only the selected exact displayed row once and invalidates originating budgets after verified success", async () => {
    const result = preview(); result.suggestions.push({ ...result.suggestions[0], categoryId: null, categoryGroupId: ids.group, currentBudget: null });
    reply = async () => response(result);
    const pending = deferred(); applyReply = () => pending.promise;
    const invalidate = vi.spyOn(mocks.client!, "invalidateQueries");
    mount(); await openPreview(); await ready();
    expect(within(dialog()).getAllByRole("checkbox")).toHaveLength(2);
    await reviewDining();
    const confirm = confirmButton(); fireEvent.click(confirm); fireEvent.click(confirm);
    await waitFor(() => expect(applyRequests()).toHaveLength(1));
    const request = applyRequests()[0], body = submitted(request);
    expect(body).toEqual({ operationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i), months: 3, targetPeriod: "2026-11", suggestions: [result.suggestions[0]] });
    expect(request.headers.get("X-Capital-Subject")).toBe(ids.subject); expect(request.headers.get("X-Capital-Household")).toBe(ids.household);
    expect(request.headers.get("x-csrf-token")).toBeTruthy(); expect(request.credentials).toBe("include");
    expect(within(dialog()).getByRole("button", { name: "Refresh preview" })).toBeDisabled();
    await act(async () => { pending.resolve(response({ operationId: body.operationId, targetPeriod: body.targetPeriod, appliedCount: 1 })); });
    expect(await within(dialog()).findByRole("status")).toHaveTextContent(/applied 1.*November 2026/i);
    expect(within(dialog()).queryByRole("table")).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["budgets"] });
    for (const mutation of [mocks.create, mocks.update, mocks.forecast, mocks.move, mocks.clear, mocks.settings]) expect(mutation).not.toHaveBeenCalled();
  });

  it("confirms that a selected new limit creates only the displayed month's limit without a future-month default", async () => {
    const result = preview(); result.suggestions[0] = { ...result.suggestions[0], categoryId: null, categoryGroupId: ids.group, currentBudget: null };
    reply = async () => response(result); mount(); await openPreview(); await ready();
    fireEvent.click(within(dialog()).getByRole("checkbox", { name: "Select Food" })); fireEvent.click(reviewButton());
    const confirmation = within(dialog()).getByRole("region", { name: "Confirm budget changes" });
    expect(confirmation).toHaveTextContent("No current budget → ZMW 183.33");
    expect(confirmation).toHaveTextContent(/new limit.*only.*November 2026/i);
    expect(confirmation).toHaveTextContent(/no future-month default/i);
    expect(applyRequests()).toEqual([]); fireEvent.click(confirmButton());
    await waitFor(() => expect(applyRequests()).toHaveLength(1));
    expect(submitted(applyRequests()[0]).suggestions).toEqual([result.suggestions[0]]);
  });

  it("withdraws selected choices and confirmation on refresh or automatic focus renewal", async () => {
    mount(); await openPreview(); await ready(); await reviewDining();
    const next = deferred(); reply = () => next.promise;
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(within(dialog()).queryByRole("region", { name: "Confirm budget changes" })).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("checkbox")).not.toBeInTheDocument();
    await act(async () => { next.resolve(response(preview("201.11"))); }); await ready("201.11");
    expect(within(dialog()).getByRole("checkbox", { name: "Select Dining" })).not.toBeChecked(); expect(reviewButton()).toBeDisabled(); unchanged();
  });

  it("requires a fresh preview after a conflict and never sends changed suggestions automatically", async () => {
    applyReply = async () => failure(409, "Preview changed");
    mount(); await openPreview(); await ready(); await reviewDining(); fireEvent.click(confirmButton());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(/refresh preview/i);
    expect(within(dialog()).queryByRole("table")).not.toBeInTheDocument(); expect(applyRequests()).toHaveLength(1);
    reply = async () => response(preview("201.11")); fireEvent.click(within(dialog()).getByRole("button", { name: "Refresh preview" })); await ready("201.11");
    expect(reviewButton()).toBeDisabled(); expect(applyRequests()).toHaveLength(1);
  });

  it.each(["lost response", "mismatched operation", "mismatched month", "wrong count"])("keeps an immutable same-id retry after %s", async outcome => {
    let attempt = 0;
    applyReply = async request => {
      const body = submitted(request);
      if (++attempt > 1) return response({ operationId: body.operationId, targetPeriod: body.targetPeriod, appliedCount: 1 });
      if (outcome === "lost response") throw new TypeError("Network connection lost after send");
      return response({ operationId: outcome === "mismatched operation" ? ids.budget : body.operationId,
        targetPeriod: outcome === "mismatched month" ? "2026-12" : body.targetPeriod, appliedCount: outcome === "wrong count" ? 2 : 1 });
    };
    const invalidate = vi.spyOn(mocks.client!, "invalidateQueries");
    mount(); await openPreview(); await ready(); await reviewDining(); fireEvent.click(confirmButton());
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent(/could not confirm|unable to confirm/i);
    expect(invalidate).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole("button", { name: "Refresh preview" })).toBeDisabled();
    expect(within(dialog()).queryByRole("checkbox", { name: "Select Dining" })).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("table")).not.toBeInTheDocument();
    expect(within(dialog()).queryByText(/183\.33|550\.00|500\.00/)).not.toBeInTheDocument();
    const count = previewRequests().length;
    act(() => { window.dispatchEvent(new Event("focus")); onlineManager.setOnline(false); onlineManager.setOnline(true); });
    expect(previewRequests()).toHaveLength(count); expect(applyRequests()).toHaveLength(1);
    await closePreview(); fireEvent.click(trigger());
    fireEvent.click(await within(dialog()).findByRole("button", { name: "Retry the same confirmed changes" }));
    await waitFor(() => expect(applyRequests()).toHaveLength(2));
    expect(applyRequests()[1].body).toBe(applyRequests()[0].body);
    expect(await within(dialog()).findByRole("status")).toHaveTextContent(/applied 1/i);
  });

  it.each(["reopen", "focus", "offline"] as const)("withdraws selected and unselected history across %s while retaining only an opaque safe retry", async renewal => {
    const result = preview(); result.suggestions.push({ ...result.suggestions[0], categoryId: null, categoryGroupId: ids.group,
      historicalTotal: { amount: "9876.54", currency: "ZMW" }, amount: { amount: "3292.18", currency: "ZMW" }, currentBudget: null });
    reply = async () => response(result); applyReply = async () => { throw new TypeError("Response lost after send"); };
    mount(); await openPreview(); await ready(); await reviewDining(); fireEvent.click(confirmButton());
    await within(dialog()).findByRole("alert");
    // A later visibility change removes the unselected history from fresh reads.
    reply = async () => response({ ...preview("201.11"), suggestions: [] });
    if (renewal === "reopen") { await closePreview(); fireEvent.click(trigger()); }
    if (renewal === "focus") act(() => { window.dispatchEvent(new Event("focus")); });
    if (renewal === "offline") act(() => { onlineManager.setOnline(false); });
    expect(within(dialog()).queryByRole("table")).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("region", { name: "Confirm budget changes" })).not.toBeInTheDocument();
    expect(within(dialog()).queryByText(/183\.33|550\.00|9876\.54|3292\.18/)).not.toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Retry the same confirmed changes" })).toBeInTheDocument();
    expect(applyRequests()).toHaveLength(1);
    expect(submitted(applyRequests()[0]).suggestions).toEqual([result.suggestions[0]]);
  });

  it.each(["submitting", "uncertain"] as const)("retains a %s operation across closing the outer Settings without replaying retired display values", async phase => {
    const pending = deferred(); let attempts = 0;
    applyReply = async request => {
      const body = submitted(request);
      if (++attempts === 1) return pending.promise;
      return response({ operationId: body.operationId, targetPeriod: body.targetPeriod, appliedCount: 1 });
    };
    mount(); await openPreview(); await ready(); await reviewDining(); fireEvent.click(confirmButton());
    await waitFor(() => expect(applyRequests()).toHaveLength(1));
    if (phase === "uncertain") {
      await act(async () => { pending.resolve(failure(500, "Response lost after commit")); }); await within(dialog()).findByRole("alert");
    }
    await closePreview(); fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByText("Budget Settings")).not.toBeInTheDocument();
    await openSettings(); fireEvent.click(trigger());
    expect(within(dialog()).queryByRole("table")).not.toBeInTheDocument();
    expect(within(dialog()).queryByText(/183\.33|550\.00|500\.00/)).not.toBeInTheDocument();
    if (phase === "submitting") {
      expect(within(dialog()).getByRole("status")).toHaveTextContent(/applying/i);
      await act(async () => { pending.resolve(failure(500, "Response lost after commit")); });
    }
    fireEvent.click(await within(dialog()).findByRole("button", { name: "Retry the same confirmed changes" }));
    await waitFor(() => expect(applyRequests()).toHaveLength(2));
    expect(applyRequests()[1].body).toBe(applyRequests()[0].body); expect(previewRequests()).toHaveLength(1);
    expect(await within(dialog()).findByRole("status")).toHaveTextContent(/applied 1/i);
  });

  it("keeps a lost committed result uncertain after a same-lifetime membership downgrade rejects its retry", async () => {
    let attempts = 0;
    applyReply = async () => {
      if (++attempts === 1) { mocks.budgets = mocks.budgets.map(budget => ({ ...budget, amount: { amount: "183.33", currency: "ZMW" } })); throw new TypeError("Committed but response lost"); }
      return new Response(JSON.stringify({ success: false, error: { code: "FORBIDDEN", message: "Editors only" } }), { status: 403, headers: { "content-type": "application/json" } });
    };
    const invalidate = vi.spyOn(mocks.client!, "invalidateQueries");
    const view = mount(); await openPreview(); await ready(); await reviewDining(); fireEvent.click(confirmButton());
    await within(dialog()).findByRole("alert");
    // Authority changed on the server before the client learned the new role.
    view.rerender(tree()); fireEvent.click(within(dialog()).getByRole("button", { name: "Retry the same confirmed changes" }));
    await waitFor(() => expect(applyRequests()).toHaveLength(2));
    const alert = await within(dialog()).findByRole("alert");
    expect(alert).toHaveTextContent(/could not confirm|unable to confirm/i); expect(alert).toHaveTextContent(/recheck/i);
    expect(alert).not.toHaveTextContent(/could not be applied|have not changed/i);
    expect(within(dialog()).queryByRole("table")).not.toBeInTheDocument(); expect(within(dialog()).queryByText(/183\.33|550\.00/)).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Retry the same confirmed changes" })).not.toBeInTheDocument();
    expect(applyRequests()[1].body).toBe(applyRequests()[0].body);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Recheck current budgets" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["budgets"] }));
    const currentRead = requests.find(request => request.url.pathname === "/api/budgets/progress");
    expect(currentRead).toBeDefined(); expect(currentRead!.method).toBe("GET"); expect(currentRead!.cache).toBe("no-store");
    expect(currentRead!.url.searchParams.get("year")).toBe("2026"); expect(currentRead!.url.searchParams.get("month")).toBe("11");
    expect(currentRead!.headers.get("X-Capital-Subject")).toBe(ids.subject); expect(currentRead!.headers.get("X-Capital-Household")).toBe(ids.household);
    expect(currentRead!.credentials).toBe("include"); expect(applyRequests()).toHaveLength(2);
  });

  it("withholds a retry write after a known membership downgrade while keeping a protected recheck available", async () => {
    applyReply = async () => { throw new TypeError("Result unknown"); };
    const view = mount(); await openPreview(); await ready(); await reviewDining(); fireEvent.click(confirmButton()); await within(dialog()).findByRole("alert");
    if (mocks.status?.state === "ready") mocks.status = { ...mocks.status, household: { ...mocks.status.household, role: "view_only" } };
    view.rerender(tree());
    expect(within(dialog()).queryByRole("button", { name: "Retry the same confirmed changes" })).not.toBeInTheDocument();
    expect(within(dialog()).queryByRole("table")).not.toBeInTheDocument(); expect(applyRequests()).toHaveLength(1);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Recheck current budgets" }));
    await waitFor(() => expect(requests.some(request => request.url.pathname === "/api/budgets/progress" && request.method === "GET")).toBe(true));
    expect(applyRequests()).toHaveLength(1);
  });

  it.each(["subject", "household", "A to B to A"] as const)("retires a confirmed operation across %s changes before a delayed response", async change => {
    const pending = deferred(); applyReply = () => pending.promise;
    const oldClient = mocks.client!, invalidate = vi.spyOn(oldClient, "invalidateQueries");
    const view = mount(); await openPreview(); await ready(); await reviewDining(); fireEvent.click(confirmButton());
    await waitFor(() => expect(applyRequests()).toHaveLength(1)); const body = submitted(applyRequests()[0]);
    setLifetime(change === "household" ? ids.subject : "66666666-6666-4666-8666-666666666666", change === "subject" ? ids.household : "77777777-7777-4777-8777-777777777777"); view.rerender(tree());
    if (change === "A to B to A") { setLifetime(ids.subject, ids.household); view.rerender(tree()); }
    await act(async () => { pending.resolve(response({ operationId: body.operationId, targetPeriod: body.targetPeriod, appliedCount: 1 })); });
    expect(screen.queryByRole("dialog", { name: "Budget suggestions" })).not.toBeInTheDocument(); expect(screen.queryByText(/applied 1/i)).not.toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(trigger()); await ready(); expect(reviewButton()).toBeDisabled(); expect(applyRequests()).toHaveLength(1);
  });
});
afterEach(() => { cleanup(); clients.forEach(retireDataClient); retireOperationLifetime(mocks.operation); mocks.client = null; mocks.operation = null; mocks.lifetime = null; mocks.status = null; onlineManager.setOnline(true); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("FIN-07 ordinary settings preview uses the real page and protected GET transport", () => {
  it("renders the existing manual amount before any preview and makes no recalculation request", async () => {
    mount(); await screen.findByLabelText("Budget amount for Dining"); unchanged(); expect(previewRequests()).toEqual([]);
  });
  it("disables preview while the signed session scope is still checking", async () => {
    mocks.ready = false; mount(); await openSettings(); expect(trigger()).toBeDisabled();
    fireEvent.click(trigger()); expect(previewRequests()).toEqual([]); unchanged();
  });
  it("requests only the agreed three-month preview with originating identity and displays the server suggestion before any write", async () => {
    mount(); await openPreview();
    await waitFor(() => expect(previewRequests()).toHaveLength(1));
    const request = previewRequests()[0]; expect(request.method).toBe("GET"); expect(Array.from(request.url.searchParams.entries())).toEqual([["months", "3"]]);
    expect(request.headers.get("X-Capital-Subject")).toBe(ids.subject); expect(request.headers.get("X-Capital-Household")).toBe(ids.household); expect(request.credentials).toBe("include");
    await ready(); const content = within(dialog());
    expect(content.getByText("Dining")).toBeInTheDocument(); expect(content.getByText(/550\.00/)).toBeInTheDocument(); expect(content.getByText(/500\.00/)).toBeInTheDocument(); expect(content.getAllByText(/ZMW/).length).toBeGreaterThan(0);
    expect(content.getByText(/2026-11|Nov(?:ember)?\s+2026/i)).toBeInTheDocument();
    for (const period of [/2026-08|Aug(?:ust)?\s+2026/i, /2026-09|Sep(?:tember)?\s+2026/i, /2026-10|Oct(?:ober)?\s+2026/i]) expect(content.getByText(period)).toBeInTheDocument();
    expect(content.queryByRole("button", { name: /apply|replace|confirm changes/i })).not.toBeInTheDocument(); unchanged();
  });
  it("keeps manual Dining 500 intact when an older server returns 404, with no POST fallback", async () => {
    reply = async () => failure(404, "Preview is unavailable on this server"); mount(); await openPreview();
    expect(await within(await screen.findByRole("dialog", { name: "Budget suggestions" })).findByRole("alert")).toHaveTextContent(/unavailable|unable|could not/i);
    expect(within(dialog()).queryByRole("table")).not.toBeInTheDocument(); unchanged();
  });
  it("shows checking without fabricated zero suggestions while the real preview response is deferred", async () => {
    const pending = deferred(); reply = () => pending.promise; mount(); await openPreview();
    await waitFor(() => expect(previewRequests()).toHaveLength(1));
    expect(within(dialog()).getByRole("status")).toHaveTextContent(/prepar|load|check/i);
    expect(within(dialog()).queryByRole("table")).not.toBeInTheDocument(); unchanged();
    await act(async () => { pending.resolve(response(preview())); }); await ready(); unchanged();
  });
  it("renders a genuine empty preview distinctly and retains the manual budget", async () => {
    reply = async () => response({ ...preview(), suggestions: [] }); mount(); await openPreview();
    expect(await within(await screen.findByRole("dialog", { name: "Budget suggestions" })).findByText(/no.*suggestions/i)).toBeInTheDocument(); unchanged();
  });
  it("uses the returned denomination rather than relabeling a USD suggestion with the ZMW display preference", async () => {
    reply = async () => response(preview("183.33", "USD")); mount(); await openPreview(); await ready();
    expect(within(dialog()).getAllByText(/USD/).length).toBeGreaterThan(0); expect(within(dialog()).queryByText(/ZMW/)).not.toBeInTheDocument(); unchanged();
  });
  it("supports a group-only suggestion and an absent current budget without inventing zero", async () => {
    const result = preview(); result.suggestions[0] = { ...result.suggestions[0], categoryId: null, categoryGroupId: ids.group, currentBudget: null };
    reply = async () => response(result); mount(); await openPreview(); await ready();
    expect(within(dialog()).getByText("Food")).toBeInTheDocument(); expect(within(dialog()).getByText(/no current budget|not budgeted/i)).toBeInTheDocument(); unchanged();
  });
  it.each(["both destinations", "no destination", "invalid amount", "negative total", "short history", "gapped history", "unordered history", "wrong mode"])("refuses an unverified %s response without exposing it as a usable suggestion", async invalid => {
    const result = preview();
    if (invalid === "both destinations") result.suggestions[0].categoryGroupId = ids.group;
    if (invalid === "no destination") result.suggestions[0].categoryId = null;
    if (invalid === "invalid amount") result.suggestions[0].amount.amount = "NaN";
    if (invalid === "negative total") result.suggestions[0].historicalTotal.amount = "-1.00";
    if (invalid === "short history") result.periods.shift();
    if (invalid === "gapped history") result.periods[0] = "2026-07";
    if (invalid === "unordered history") result.periods.reverse();
    reply = async () => response(invalid === "wrong mode" ? { ...result, mode: "applied" } : result);
    mount(); await openPreview();
    expect(await within(await screen.findByRole("dialog", { name: "Budget suggestions" })).findByRole("alert")).toBeInTheDocument();
    expect(within(dialog()).queryByText(/183\.33/)).not.toBeInTheDocument(); unchanged();
  });
  it("withdraws a prior preview immediately during refresh and leaves no stale amounts after failure", async () => {
    mount(); await openPreview(); await ready();
    const next = deferred(); reply = () => next.promise;
    fireEvent.click(within(dialog()).getByRole("button", { name: "Refresh preview" }));
    expect(within(dialog()).queryByText(/183\.33/)).not.toBeInTheDocument();
    await waitFor(() => expect(previewRequests()).toHaveLength(2));
    await act(async () => { next.resolve(failure(500, "Current preview is unavailable")); });
    expect(await within(dialog()).findByRole("alert")).toBeInTheDocument(); expect(within(dialog()).queryByRole("table")).not.toBeInTheDocument(); unchanged();
  });
  it.each(["success", "error"] as const)("ignores a canceled request's late %s after quick reopen and preserves the newer preview", async outcome => {
    const old = deferred(), next = deferred(); let count = 0; reply = () => ++count === 1 ? old.promise : next.promise;
    mount(); await openPreview(); await waitFor(() => expect(previewRequests()).toHaveLength(1));
    await closePreview(); fireEvent.click(trigger()); await waitFor(() => expect(previewRequests()).toHaveLength(2));
    await act(async () => { next.resolve(response(preview("201.11"))); }); await ready("201.11");
    await act(async () => { old.resolve(outcome === "success" ? response(preview()) : failure(500, "Canceled old error marker")); });
    expect(within(dialog()).getByText(/201\.11/)).toBeInTheDocument(); expect(within(dialog()).queryByText(/183\.33|Canceled old error marker/)).not.toBeInTheDocument(); unchanged();
  });
  it.each(["subject", "household", "A to B to A"] as const)("withdraws preview across %s lifetime changes and rejects the originating late response", async change => {
    const old = deferred(); reply = () => old.promise; const view = mount(); await openPreview(); await waitFor(() => expect(previewRequests()).toHaveLength(1));
    setLifetime(change === "household" ? ids.subject : "66666666-6666-4666-8666-666666666666", change === "subject" ? ids.household : "77777777-7777-4777-8777-777777777777"); view.rerender(tree());
    if (change === "A to B to A") { setLifetime(ids.subject, ids.household); view.rerender(tree()); }
    await act(async () => { old.resolve(response(preview())); });
    expect(screen.queryByText(/183\.33/)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Budget suggestions" })).not.toBeInTheDocument(); unchanged();
  });
  it("withdraws a ready preview while its freshness check is paused offline", async () => {
    mount(); await openPreview(); await ready();
    act(() => { onlineManager.setOnline(false); });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Refresh preview" }));
    expect(within(dialog()).queryByText(/183\.33/)).not.toBeInTheDocument(); expect(within(dialog()).queryByRole("table")).not.toBeInTheDocument(); unchanged();
  });
  it("closes with Escape and restores keyboard focus to the connected preview opener without changing budgets", async () => {
    const user = userEvent.setup(); mount(); await openPreview(); await ready();
    await user.keyboard("{Escape}"); await waitFor(() => expect(screen.queryByRole("dialog", { name: "Budget suggestions" })).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus(); unchanged();
  });
});
