import { webcrypto } from "node:crypto";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { investmentKeys } from "@/hooks/investments/keys";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { AddRecurringInvestmentForm } from "../AddRecurringInvestmentForm";
import { RecurringInvestmentSetup } from "../RecurringInvestmentSetup";

// Existing form, panel, recurring hooks, QueryClient and operation lifetime are real.
// Only apiRequest, reference reads, session and display/toast adapters are replaced.
// These are client caller oracles, not signed HTTP, CSRF/step-up resend, DB, scheduler
// or built-browser evidence. The explicit route-removal case unmounts the real panel;
// it does not claim coverage of App's router or SessionProvider transitions.
const ids = {
  subject: "11111111-1111-4111-8111-111111111111", household: "22222222-2222-4222-8222-222222222222",
  account: "33333333-3333-4333-8333-333333333333", security: "44444444-4444-4444-8444-444444444444",
  plan: "55555555-5555-4555-8555-555555555555", otherSubject: "66666666-6666-4666-8666-666666666666",
  otherHousehold: "77777777-7777-4777-8777-777777777777",
};
const mocks = vi.hoisted(() => ({
  api: vi.fn(), occurrenceRead: vi.fn(), toast: vi.fn(), accountRead: vi.fn(), archivedOnly: false, currency: "USD",
  lifetime: null as { key: string; operation: OperationLifetime; client: QueryClient } | null,
  format: vi.fn((value: number, currency = "ZMW") => `${currency} ${value.toFixed(2)}`),
}));
vi.mock("@/lib/queryClient", async original => ({ ...await original<typeof import("@/lib/queryClient")>(), apiRequest: mocks.api }));
vi.mock("@/lib/api", async original => ({
  ...await original<typeof import("@/lib/api")>(),
  // The occurrence adapter uses apiCall. Keep it separate from the existing
  // plan transport/count oracles, accepting only the two frozen read routes.
  apiCall: async (endpoint: string, options?: RequestInit) => {
    const url = new URL(`/api${endpoint}`, "https://synthetic.invalid");
    if ((!options?.method || options.method === "GET") && url.pathname === `/api/investments/recurring/${ids.plan}/occurrences` &&
        [...url.searchParams.keys()].every(key => ["state", "limit", "before"].includes(key))) {
      return mocks.occurrenceRead();
    }
    if ((!options?.method || options.method === "GET") && url.pathname === "/api/investments/calendar" && !url.search) {
      return { success: true, data: { timeZone: "Africa/Lusaka", configured: true, permittedActions: [] } };
    }
    throw new Error(`Unexpected occurrence adapter transport: ${options?.method ?? "GET"} ${url.pathname}`);
  },
}));
vi.mock("@/hooks/useInvestments", async () => ({
  ...await import("@/hooks/investments/useRecurringInvestments"),
  useSecurities: () => ({ data: [{ id: ids.security, symbol: "SYNSTOCK", name: "Synthetic instrument",
    type: "stock", currency: mocks.currency, currentPrice: "2.00" }], isLoading: false }),
}));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: (params?: { includeArchived?: boolean; includeHidden?: boolean }) => {
  mocks.accountRead(params);
  if (mocks.archivedOnly && !(params?.includeArchived && params?.includeHidden)) return { data: [], isLoading: false };
  return { data: [{ id: ids.account, householdId: mocks.lifetime?.operation.expectations?.household,
    name: mocks.archivedOnly ? "Archived synthetic custody" : "Synthetic custody", type: "investment", currency: "ZMW", isPrivate: true,
    ownerUserId: mocks.lifetime?.operation.expectations?.subject }], isLoading: false };
} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/use-format", () => ({ useFormat: () => ({ formatCurrency: mocks.format }) }));
vi.mock("@/hooks/use-settings", () => ({ useDisplaySettings: () => ({ data: { timezone: "Africa/Lusaka" }, isLoading: false, isError: false }) }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: mocks.lifetime?.operation.expectations?.subject },
    household: { id: mocks.lifetime?.operation.expectations?.household, role: "member" } },
  lifetime: mocks.lifetime, loading: false,
}) }));

// Mirrors sipPlanResponse's public DTO. In particular there is no grant pointer or
// creator identity: authorization_required/null initial date can retain revision 12.
interface PlanDto {
  id: string; householdId: string; accountId: string; securityId: string | null;
  type: "sip" | "rollover"; frequency: string; amount: string; currency: string;
  nextExecutionDate: string; isActive: boolean; authorizationRevision: number;
  authorizationInitialExecutionDate: string | null;
  authorizationStatus: "authorization_recorded" | "authorization_required" | "inactive" | "pending_reconciliation";
  permittedActions: Array<"authorize" | "deactivate">; createdAt: string; updatedAt: string;
}
const plan: PlanDto = {
  id: ids.plan, householdId: ids.household, accountId: ids.account, securityId: ids.security,
  type: "sip", frequency: "semi_annually", amount: "10.00", currency: "USD",
  nextExecutionDate: "2031-01-20", isActive: true, authorizationRevision: 7,
  authorizationInitialExecutionDate: "2030-01-20", authorizationStatus: "authorization_recorded",
  permittedActions: ["authorize", "deactivate"], createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z",
};
interface Observed {
  method: string; path: string; body: Record<string, unknown> | undefined; serializedBody: string | undefined;
}
let requests: Observed[], clients: QueryClient[], rows: PlanDto[];
let write: (request: Observed) => Promise<Response>;
let read: () => Promise<Response>;
let releasePending: Array<() => void>;
const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), {
  status: 200, headers: { "Content-Type": "application/json" },
});
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const createButton = /Confirm Setup|Record.*plan|Create.*plan/i;
const retryButton = /retry.*(?:same|original|plan|request|declaration|setup|investment|command|creation)|^retry$/i;
const authorizeButton = /^(?:Authorize|Reconfirm)(?:\b|\s)|^(?:Record|Confirm).*authorization/i;
const deactivateButton = /deactivate|pause.*plan/i;

function scope(subject = ids.subject, household = ids.household) {
  if (mocks.lifetime) {
    retireOperationLifetime(mocks.lifetime.operation);
    retireDataClient(mocks.lifetime.client);
  }
  const operation = createOperationLifetime({ subject, household });
  activateOperationLifetime(operation);
  const client = createDataQueryClient(undefined, operation);
  clients.push(client);
  mocks.lifetime = { key: `${subject}:${household}`, operation, client };
}
function tree(content: ReactNode) {
  return <QueryClientProvider client={mocks.lifetime!.client}>{content}</QueryClientProvider>;
}
function mount(content: ReactNode) { return render(tree(content)); }
function posts() { return requests.filter(request => request.method === "POST"); }
function reads() { return requests.filter(request => request.method === "GET"); }
function capturePendingMutation(client: QueryClient) {
  const pending = client.getMutationCache().getAll().filter(mutation => mutation.state.status === "pending");
  expect(pending).toHaveLength(1);
  // Hold the real mutation object: retirement clears its cache membership, but
  // this reference still records when transport and mutation callbacks finish.
  return pending[0]!;
}
function deferred() {
  let resolve!: (response: Response) => void, reject!: (error: Error) => void;
  const promise = new Promise<Response>((done, fail) => { resolve = done; reject = fail; });
  // Cleanup retires clients before releasing any request whose product assertion
  // failed, so a pending transport cannot leak publication into another case.
  releasePending.push(() => resolve(json(plan)));
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.api.mockReset(); mocks.currency = "USD"; mocks.archivedOnly = false;
  mocks.occurrenceRead.mockReset().mockResolvedValue({ success: true, data: [], pagination: { hasMore: false, nextBefore: null } });
  vi.stubGlobal("crypto", webcrypto);
  requests = []; clients = []; rows = []; releasePending = []; mocks.lifetime = null;
  scope();
  read = async () => json(rows); // A new Response on EVERY GET, including invalidation/retry.
  write = async () => json(plan);
  mocks.api.mockImplementation((method: string, path: string, body?: Record<string, unknown>) => {
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    const request = { method, path, serializedBody,
      body: serializedBody === undefined ? undefined : JSON.parse(serializedBody) as Record<string, unknown> };
    requests.push(request);
    if (method === "GET" && path === "/api/investments/recurring") return read();
    if ((method === "POST" && (path === "/api/investments/recurring" || path === `/api/investments/recurring/${ids.plan}/authorize`)) ||
      (method === "DELETE" && path === `/api/investments/recurring/${ids.plan}`)) return write(request);
    throw new Error(`Unexpected test transport: ${method} ${path}`);
  });
});
afterEach(async () => {
  cleanup();
  retireOperationLifetime(mocks.lifetime?.operation);
  for (const client of clients) retireDataClient(client);
  await act(async () => { for (const release of releasePending) release(); });
  mocks.lifetime = null; vi.unstubAllGlobals();
});

it("withdraws the open SIP dialog's cached plan terms after occurrence custody refusal and keeps them hidden on reopening", async () => {
  rows = [plan];
  const user = userEvent.setup();
  mount(<RecurringInvestmentSetup />);
  await user.click(await screen.findByRole("button", { name: "Details" }));
  const opened = within(await screen.findByRole("dialog", { name: "Recurring plan details" }));
  expect(await opened.findByText("No pending scheduled purchases.")).toBeVisible();
  expect(opened.getByText("USD 10.00")).toBeVisible();
  expect(opened.getByText("Synthetic custody")).toBeVisible();
  expect(opened.getByText("Synthetic instrument")).toBeVisible();

  const rejected = Object.assign(new Error("Investment occurrence not found"), { status: 404, code: "NOT_FOUND" });
  mocks.occurrenceRead.mockRejectedValue(rejected);
  await act(async () => {
    await mocks.lifetime!.client.invalidateQueries({ queryKey: [...investmentKeys.recurring(), "occurrences", ids.plan] });
  });
  expect(await opened.findByRole("button", { name: "Retry scheduled purchases" })).toBeVisible();
  const expectTermsWithheld = (dialog: ReturnType<typeof within>) => {
    expect(dialog.queryByText("USD 10.00")).toBeNull();
    expect(dialog.queryByText("Synthetic custody")).toBeNull();
    expect(dialog.queryByText("Synthetic instrument")).toBeNull();
    expect(dialog.queryByText(plan.nextExecutionDate)).toBeNull();
    expect(dialog.queryByRole("button", { name: authorizeButton })).toBeNull();
    expect(dialog.queryByRole("button", { name: deactivateButton })).toBeNull();
  };
  expectTermsWithheld(opened);

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Recurring plan details" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Details" }));
  const reopened = within(await screen.findByRole("dialog", { name: "Recurring plan details" }));
  expectTermsWithheld(reopened);
  expect(await reopened.findByRole("button", { name: "Retry scheduled purchases" })).toBeEnabled();
  expect(posts()).toEqual([]);
});

async function fillCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: /Funding Account|Custody account/i }));
  await user.click(screen.getByRole("option", { name: /Synthetic custody/ }));
  await user.click(screen.getByRole("combobox", { name: /Target Security|Instrument/i }));
  await user.click(screen.getByRole("option", { name: /SYNSTOCK/ }));
  await user.click(screen.getByRole("combobox", { name: /^Frequency/i }));
  await user.click(screen.getByRole("option", { name: /Semi-Annually|Semiannually/i }));
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "10.00" } });
  fireEvent.change(screen.getByLabelText(/Start Date|Initial date/i), { target: { value: "2031-01-20" } });
}
async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: "Recurring Investments" });
  await user.click(screen.getByRole("button", { name: /Setup Automation|(?:Add|Create|Record).*plan/i }));
  await screen.findByRole("dialog");
}
async function submitCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: createButton }));
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()[0].path).toBe("/api/investments/recurring");
  return posts()[0];
}
async function openDetails(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("button", { name: /Details|Review.*plan/i });
  expect(reads().length).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: /Details|Review.*plan/i }));
}
async function reviewAuthorization(user: ReturnType<typeof userEvent.setup>) {
  await openDetails(user);
  // Baseline reachability: the real GET/list is reached before the currently
  // absent authorization action. No future controller is imported or mocked.
  return screen.findByRole("button", { name: authorizeButton });
}
function expectDisplayedDate(date: string, container: HTMLElement = document.body) {
  const [year, month, day] = date.split("-").map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const monthName = calendar.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const shortMonth = calendar.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const datePattern = new RegExp(`${date}|0?${day}[/-]0?${month}[/-]${year}|0?${month}[/-]0?${day}[/-]${year}|` +
    `(?:${monthName}|${shortMonth})\\s+${day},?\\s+${year}|${day}\\s+(?:${monthName}|${shortMonth})\\s+${year}`, "i");
  const displayed = [...within(container).queryAllByDisplayValue(date), ...within(container).queryAllByText(datePattern)];
  expect(displayed.length).toBeGreaterThan(0);
  expect(displayed[0]).toBeVisible();
}
function expectDisplayedTerms(confirm: HTMLElement, initialDate: string) {
  // If the UI uses a dialog, terms must be in that review, not merely on the
  // background card. An accessible inline review is supported as well.
  const container = confirm.closest<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="region"], section') ?? document.body;
  const review = within(container);
  expect(review.getAllByText(/Synthetic custody/)[0]).toBeVisible();
  expect(review.getAllByText(/SYNSTOCK|Synthetic instrument/)[0]).toBeVisible();
  expect(review.getAllByText(/USD\s*10\.00|10\.00\s*USD/)[0]).toBeVisible();
  expect(review.getAllByText(/semi[_ -]?annually|every (?:six|6) months/i)[0]).toBeVisible();
  expectDisplayedDate(initialDate, container);
  expect(posts()).toEqual([]); // Opening Details/review is not consent to send.
}

it("synchronously admits only one create when two submit events arrive before the POST settles", async () => {
  const pending = deferred(); write = () => pending.promise;
  mount(<AddRecurringInvestmentForm onSuccess={vi.fn()} />);
  const user = userEvent.setup(); await fillCreate(user);
  const form = screen.getByRole("button", { name: createButton }).closest("form")!;
  // Native form submission bypasses the visual disabled button, exercising the
  // command admission boundary rather than relying on a later React rerender.
  await act(async () => { fireEvent.submit(form); fireEvent.submit(form); });
  await waitFor(() => expect(posts().length).toBeGreaterThan(0));
  expect(posts()).toHaveLength(1);
  await act(async () => pending.resolve(json(plan)));
});

it("keeps an uncertain create immutable, blocks replacing its intent, and explicitly retries the same UUID/body", async () => {
  let attempt = 0;
  write = async () => { if (++attempt === 1) throw new TypeError("Synthetic acknowledgement lost"); return json(plan); };
  const onSuccess = vi.fn(), view = mount(<AddRecurringInvestmentForm onSuccess={onSuccess} />);
  const user = userEvent.setup(); await fillCreate(user); const original = await submitCreate(user);
  expect(onSuccess).not.toHaveBeenCalled();
  // Baseline has dispatched a real create before this missing recovery control.
  const retry = await screen.findByRole("button", { name: retryButton });
  expect(screen.getByLabelText(/^Amount/)).toBeDisabled();
  expect(screen.getByLabelText(/Start Date|Initial date/i)).toBeDisabled();
  expect(screen.getByRole("combobox", { name: /^Frequency/i })).toBeDisabled();
  mocks.currency = "ZMW";
  view.rerender(tree(<AddRecurringInvestmentForm onSuccess={onSuccess} />));
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "99.00" } });
  const form = screen.getByLabelText(/^Amount/).closest("form")!;
  await act(async () => { fireEvent.submit(form); });
  expect(posts()).toHaveLength(1);
  await user.click(retry);
  await waitFor(() => expect(posts()).toHaveLength(2));
  expect(original.body).toEqual({ operationId: expect.stringMatching(uuid), type: "sip", accountId: ids.account,
    securityId: ids.security, amount: "10.00", currency: "USD", frequency: "semi_annually", nextExecutionDate: "2031-01-20" });
  expect(posts()[1].body).toEqual(original.body);
  expect(posts()[1].serializedBody).toBe(original.serializedBody);
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  // Definitive acknowledgement releases the old command. Only an expressly new
  // confirmation may allocate another UUID, even for identical financial terms.
  view.unmount(); mocks.currency = "USD";
  mount(<AddRecurringInvestmentForm onSuccess={onSuccess} />);
  await fillCreate(user);
  await user.click(screen.getByRole("button", { name: createButton }));
  await waitFor(() => expect(posts()).toHaveLength(3));
  expect(posts()[2].body?.operationId).toEqual(expect.stringMatching(uuid));
  expect(posts()[2].body?.operationId).not.toBe(original.body?.operationId);
  expect(posts()[2].body).toEqual({ ...original.body, operationId: posts()[2].body?.operationId });
});

it.each([
  { field: "authorization status", malformed: { authorizationStatus: "unknown_status" } },
  { field: "permitted action", malformed: { permittedActions: ["authorize", "unexpected_action"] } },
])("retries the original create after an acknowledgement with an invalid $field", async ({ malformed }) => {
  const acknowledgement = { ...plan, authorizationRevision: 1, authorizationInitialExecutionDate: plan.nextExecutionDate };
  write = async () => json({ ...acknowledgement, ...malformed });
  const onSuccess = vi.fn();
  const user = userEvent.setup();
  mount(<AddRecurringInvestmentForm onSuccess={onSuccess} />);
  await fillCreate(user);
  const original = await submitCreate(user);

  const retry = await screen.findByRole("button", { name: retryButton });
  expect(screen.getByRole("alert")).toHaveTextContent(/unconfirmed/i);
  expect(screen.getByLabelText(/^Amount/)).toBeDisabled();
  expect(onSuccess).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalledWith({ title: "Recurring plan recorded" });
  expect(posts()).toHaveLength(1);
  expect(original.body?.operationId).toEqual(expect.stringMatching(uuid));

  write = async () => json(acknowledgement);
  await user.click(retry);
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  expect(posts()).toEqual([original, original]);
  expect(screen.queryByRole("button", { name: retryButton })).toBeNull();
});

it("resumes the pending create after closing and reopening the real setup dialog", async () => {
  const pending = deferred(); write = () => pending.promise;
  mount(<RecurringInvestmentSetup />);
  const user = userEvent.setup(); await openCreate(user); await fillCreate(user); const original = await submitCreate(user);
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Close$/i }));
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => pending.reject(new TypeError("Synthetic acknowledgement lost while closed")));
  await openCreate(user);
  expect(screen.getByLabelText(/^Amount/)).toHaveValue(10);
  expect(screen.getByLabelText(/^Amount/)).toBeDisabled();
  write = async () => json(plan);
  await user.click(await screen.findByRole("button", { name: retryButton }));
  await waitFor(() => expect(posts()).toHaveLength(2));
  expect(posts()[1].body).toEqual(original.body);
});

function RecurringTabs() {
  return <Tabs defaultValue="recurring"><TabsList>
    <TabsTrigger value="recurring">Recurring</TabsTrigger><TabsTrigger value="other">Other investments</TabsTrigger>
  </TabsList><TabsContent value="recurring"><RecurringInvestmentSetup /></TabsContent>
    <TabsContent value="other"><p>Other investment view</p></TabsContent></Tabs>;
}
it("retains the original command when the actual tab primitive unmounts the recurring panel", async () => {
  const pending = deferred(); write = () => pending.promise;
  mount(<RecurringTabs />);
  const user = userEvent.setup(); await openCreate(user); await fillCreate(user); const original = await submitCreate(user);
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Close$/i }));
  await user.click(screen.getByRole("tab", { name: "Other investments" }));
  expect(screen.queryByRole("heading", { name: "Recurring Investments" })).toBeNull();
  await act(async () => pending.reject(new TypeError("Synthetic acknowledgement lost off tab")));
  await user.click(screen.getByRole("tab", { name: "Recurring" }));
  await openCreate(user);
  write = async () => json(plan);
  await user.click(await screen.findByRole("button", { name: retryButton }));
  await waitFor(() => expect(posts()).toHaveLength(2));
  expect(posts()[1].body).toEqual(original.body);
});

it("retains the original command across route removal and remount of the real panel in the same lifetime", async () => {
  const pending = deferred(); write = () => pending.promise;
  const firstVisit = mount(<RecurringInvestmentSetup />), operation = mocks.lifetime!.operation;
  const user = userEvent.setup(); await openCreate(user); await fillCreate(user); const original = await submitCreate(user);
  firstVisit.unmount(); // Models the route boundary, without mounting the unrelated application shell.
  await act(async () => pending.reject(new TypeError("Synthetic acknowledgement lost away from route")));
  mount(<RecurringInvestmentSetup />);
  expect(mocks.lifetime!.operation).toBe(operation);
  await openCreate(user);
  write = async () => json(plan);
  await user.click(await screen.findByRole("button", { name: retryButton }));
  await waitFor(() => expect(posts()).toHaveLength(2));
  expect(posts()[1].body).toEqual(original.body);
});

it("withdraws a retired lifetime's late toast, callback and cache publication and gives the next household no pending command", async () => {
  const pending = deferred(); write = () => pending.promise;
  const onSuccess = vi.fn(), oldClient = mocks.lifetime!.client;
  const oldInvalidate = vi.spyOn(oldClient, "invalidateQueries");
  mount(<AddRecurringInvestmentForm onSuccess={onSuccess} />);
  const user = userEvent.setup(); await fillCreate(user); await submitCreate(user);
  const oldMutation = capturePendingMutation(oldClient);
  scope(ids.otherSubject, ids.otherHousehold);
  const nextClient = mocks.lifetime!.client, nextInvalidate = vi.spyOn(nextClient, "invalidateQueries");
  const nextOnSuccess = vi.fn(), nextView = mount(<AddRecurringInvestmentForm onSuccess={nextOnSuccess} />);
  const nextForm = within(nextView.container);
  expect(oldMutation.state.status).toBe("pending");
  expect(nextForm.getByLabelText(/^Amount/)).toHaveValue(null);
  expect(nextForm.getByLabelText(/^Amount/)).toBeEnabled();
  expect(nextForm.queryByRole("button", { name: retryButton })).toBeNull();
  fireEvent.change(nextForm.getByLabelText(/^Amount/), { target: { value: "24.00" } });
  fireEvent.change(nextForm.getByLabelText(/Start Date|Initial date/i), { target: { value: "2032-02-21" } });
  // Keep the old observer mounted until completion: unmounting it here would
  // suppress TanStack's per-call callback and hide a stale product callback bug.
  await act(async () => pending.resolve(json(plan)));
  await waitFor(() => expect(["success", "error"]).toContain(oldMutation.state.status));
  expect(onSuccess).not.toHaveBeenCalled();
  expect(nextOnSuccess).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(oldInvalidate).not.toHaveBeenCalled();
  expect(nextInvalidate).not.toHaveBeenCalled();
  expect(oldClient.getQueryData(investmentKeys.recurring())).toBeUndefined();
  expect(nextClient.getQueryData(investmentKeys.recurring())).toBeUndefined();
  expect(nextForm.getByLabelText(/^Amount/)).toBeVisible();
  expect(nextForm.getByLabelText(/^Amount/)).toHaveValue(24);
  expect(nextForm.getByLabelText(/^Amount/)).toBeEnabled();
  expect(nextForm.getByLabelText(/Start Date|Initial date/i)).toHaveValue("2032-02-21");
  expect(nextForm.queryByRole("button", { name: retryButton })).toBeNull();
  expect(posts()).toHaveLength(1);
});

it("does not inherit an unresolved command in a new operation lifetime for the same subject and household", async () => {
  const pending = deferred(); write = () => pending.promise;
  const oldLifetime = mocks.lifetime!, oldOnSuccess = vi.fn();
  const oldInvalidate = vi.spyOn(oldLifetime.client, "invalidateQueries");
  mount(<AddRecurringInvestmentForm onSuccess={oldOnSuccess} />);
  const user = userEvent.setup(); await fillCreate(user); await submitCreate(user);
  const oldMutation = capturePendingMutation(oldLifetime.client);
  scope();
  expect(mocks.lifetime!.key).toBe(oldLifetime.key);
  expect(mocks.lifetime!.operation.expectations).toEqual(oldLifetime.operation.expectations);
  expect(mocks.lifetime!.operation).not.toBe(oldLifetime.operation);
  const nextClient = mocks.lifetime!.client, nextInvalidate = vi.spyOn(nextClient, "invalidateQueries");
  const nextOnSuccess = vi.fn(), nextView = mount(<AddRecurringInvestmentForm onSuccess={nextOnSuccess} />);
  const nextForm = within(nextView.container);
  // The textual subject/household key is unchanged. The fresh operation object
  // must nevertheless own fresh state while the retired observer is still live.
  expect(oldMutation.state.status).toBe("pending");
  expect(nextForm.getByLabelText(/^Amount/)).toHaveValue(null);
  expect(nextForm.getByLabelText(/^Amount/)).toBeEnabled();
  expect(nextForm.queryByRole("button", { name: retryButton })).toBeNull();
  fireEvent.change(nextForm.getByLabelText(/^Amount/), { target: { value: "37.00" } });
  fireEvent.change(nextForm.getByLabelText(/Start Date|Initial date/i), { target: { value: "2034-03-22" } });
  await act(async () => pending.resolve(json(plan)));
  await waitFor(() => expect(["success", "error"]).toContain(oldMutation.state.status));
  expect(oldOnSuccess).not.toHaveBeenCalled();
  expect(nextOnSuccess).not.toHaveBeenCalled();
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(oldInvalidate).not.toHaveBeenCalled();
  expect(nextInvalidate).not.toHaveBeenCalled();
  expect(nextClient.getQueryData(investmentKeys.recurring())).toBeUndefined();
  expect(nextForm.getByLabelText(/^Amount/)).toBeVisible();
  expect(nextForm.getByLabelText(/^Amount/)).toHaveValue(37);
  expect(nextForm.getByLabelText(/^Amount/)).toBeEnabled();
  expect(nextForm.getByLabelText(/Start Date|Initial date/i)).toHaveValue("2034-03-22");
  expect(nextForm.queryByRole("button", { name: retryButton })).toBeNull();
  expect(posts()).toHaveLength(1);
});

it("uses only the server permittedActions array for authorization and deactivation, including visible private custody", async () => {
  rows = [{ ...plan, isActive: false, authorizationStatus: "inactive", permittedActions: ["authorize"] }];
  const user = userEvent.setup(), firstVisit = mount(<RecurringInvestmentSetup />);
  await openDetails(user);
  expect(await screen.findByRole("button", { name: authorizeButton })).toBeEnabled();
  expect(screen.queryByRole("button", { name: deactivateButton })).toBeNull();
  firstVisit.unmount(); mocks.lifetime!.client.removeQueries({ queryKey: investmentKeys.recurring() });
  rows = [{ ...plan, type: "rollover", securityId: null, authorizationRevision: 0,
    authorizationInitialExecutionDate: null, authorizationStatus: "pending_reconciliation", permittedActions: ["deactivate"] }];
  const secondVisit = mount(<RecurringInvestmentSetup />);
  await openDetails(user);
  expect(screen.queryByRole("button", { name: authorizeButton })).toBeNull();
  const deactivate = await screen.findByRole("button", { name: deactivateButton });
  write = async () => {
    rows = rows.map(row => ({ ...row, isActive: false, permittedActions: [] }));
    // DELETE returns no plan DTO and accepts no invented UUID/revision body.
    return new Response(JSON.stringify({ success: true, message: "Plan deactivated" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await user.click(deactivate);
  await waitFor(() => expect(requests.filter(request => request.method === "DELETE")).toHaveLength(1));
  expect(requests.find(request => request.method === "DELETE")).toEqual({ method: "DELETE",
    path: `/api/investments/recurring/${ids.plan}`, body: undefined, serializedBody: undefined });
  secondVisit.unmount(); mocks.lifetime!.client.removeQueries({ queryKey: investmentKeys.recurring() });
  const thirdVisit = mount(<RecurringInvestmentSetup />);
  await openDetails(user);
  expect(screen.queryByRole("button", { name: authorizeButton })).toBeNull();
  expect(screen.queryByRole("button", { name: deactivateButton })).toBeNull();
  expect(posts()).toEqual([]);
  thirdVisit.unmount(); mocks.lifetime!.client.removeQueries({ queryKey: investmentKeys.recurring() });
  // Otherwise eligible and active, with matching reference sources: type and
  // isActive cannot explain the absence of actions; only this server array can.
  rows = [{ ...plan, permittedActions: [] }];
  mount(<RecurringInvestmentSetup />);
  expect(await screen.findByRole("button", { name: /Details|Review.*plan/i })).toBeEnabled();
  await openDetails(user);
  expect((await screen.findAllByText(/SYNSTOCK|Synthetic instrument/))[0]).toBeVisible();
  expectDisplayedDate(plan.authorizationInitialExecutionDate!);
  expect(screen.queryByRole("button", { name: authorizeButton })).toBeNull();
  expect(screen.queryByRole("button", { name: deactivateButton })).toBeNull();
  expect(posts()).toEqual([]);
  expect(requests.filter(request => request.method === "DELETE")).toHaveLength(1);
});

it.each([
  { name: "original authorization date", initial: "2030-01-20", revision: 7 },
  { name: "explicit next-date fallback after grant removal with a nonzero counter", initial: null, revision: 12 },
])("displays exact terms and sends the durable revision with the $name", async ({ initial, revision }) => {
  const row: PlanDto = { ...plan, authorizationInitialExecutionDate: initial, authorizationRevision: revision,
    authorizationStatus: initial ? "authorization_recorded" : "authorization_required" };
  rows = [row];
  write = async () => {
    rows = [{ ...row, authorizationRevision: revision + 1, authorizationInitialExecutionDate: initial ?? row.nextExecutionDate,
      authorizationStatus: "authorization_recorded" }];
    return json(rows[0]);
  };
  const user = userEvent.setup(); mount(<RecurringInvestmentSetup />);
  const confirm = await reviewAuthorization(user), initialDate = initial ?? row.nextExecutionDate;
  expectDisplayedTerms(confirm, initialDate);
  if (!initial) expect(screen.getByText(/(?:next (?:scheduled |execution )?date.*(?:initial|declar))|(?:using|declare|confirm).*next (?:scheduled |execution )?date/i)).toBeVisible();
  await user.click(confirm);
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()[0].path).toBe(`/api/investments/recurring/${ids.plan}/authorize`);
  expect(posts()[0].body).toEqual({ operationId: expect.stringMatching(uuid), expectedRevision: revision,
    type: "sip", accountId: ids.account, securityId: ids.security, amount: "10.00", currency: "USD",
    frequency: "semi_annually", initialExecutionDate: initialDate });
});

it("keeps an inactive plan inactive after explicit reconfirmation succeeds", async () => {
  rows = [{ ...plan, isActive: false, authorizationStatus: "inactive", permittedActions: ["authorize"] }];
  const pending = deferred(); write = () => pending.promise;
  const user = userEvent.setup(); mount(<RecurringInvestmentSetup />);
  await user.click(await reviewAuthorization(user));
  await waitFor(() => expect(posts()).toHaveLength(1));
  const mutation = capturePendingMutation(mocks.lifetime!.client);
  rows = [{ ...rows[0], authorizationRevision: 8 }];
  await act(async () => pending.resolve(json(rows[0])));
  // A returned authoritative DTO may be published directly. Completion, not an
  // extra GET, is the barrier before checking that reconfirmation stayed inactive.
  await waitFor(() => expect(mutation.state.status).toBe("success"));
  expect((await screen.findAllByText(/^inactive$/i))[0]).toBeVisible();
  expect(screen.queryByText(/^active$/i)).toBeNull();
  expect(posts()[0].body).not.toHaveProperty("isActive");
});

it.each([
  { outcome: "shows newer terms", visible: true },
  { outcome: "omits a plan that is no longer visible", visible: false },
])("preserves a list read that $outcome when an older authorization acknowledgement arrives", async ({ visible }) => {
  const acknowledgement = { ...plan, authorizationRevision: 8 };
  const current = { ...plan, authorizationRevision: 9, amount: "20.00",
    authorizationInitialExecutionDate: "2032-02-20", nextExecutionDate: "2033-07-20" };
  const currentRows = visible ? [current] : [];
  const pending = deferred(), followUp = deferred();
  const client = mocks.lifetime!.client, queryKey = investmentKeys.recurring();
  rows = [plan];
  write = () => pending.promise;
  const user = userEvent.setup();
  mount(<RecurringInvestmentSetup />);
  const confirm = await reviewAuthorization(user);
  expectDisplayedTerms(confirm, plan.authorizationInitialExecutionDate!);
  await user.click(confirm);
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()[0].body).toMatchObject({ expectedRevision: 7 });
  const mutation = capturePendingMutation(client);

  rows = currentRows;
  await act(async () => { await client.invalidateQueries({ queryKey, exact: true }); });
  expect(reads()).toHaveLength(2);
  if (visible) {
    const dialog = within(screen.getByRole("dialog", { name: "Recurring plan details" }));
    expect(await dialog.findByText("USD 20.00")).toBeVisible();
    expect(dialog.getByText(current.nextExecutionDate)).toBeVisible();
  } else {
    expect(await screen.findByRole("heading", { name: "No recurring plans" })).toBeVisible();
  }
  expect(mutation.state.status).toBe("pending");

  read = () => followUp.promise;
  await act(async () => pending.resolve(json(acknowledgement)));
  await waitFor(() => expect(reads()).toHaveLength(3));
  expect(client.getQueryData(queryKey)).toMatchObject({ data: currentRows });
  await act(async () => followUp.reject(new Error("Synthetic follow-up read failed")));
  await waitFor(() => expect(mutation.state.status).toBe("success"));
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be refreshed/i);

  expect(client.getQueryData(queryKey)).toMatchObject({ data: currentRows });
  if (visible) {
    const dialog = within(screen.getByRole("dialog", { name: "Recurring plan details" }));
    expect(dialog.getByText("USD 20.00")).toBeVisible();
    expect(dialog.getByText(current.authorizationInitialExecutionDate)).toBeVisible();
    expect(dialog.getByText(current.nextExecutionDate)).toBeVisible();
    expect(dialog.queryByText("USD 10.00")).toBeNull();
  } else {
    expect(screen.queryByRole("dialog", { name: "Recurring plan details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  }
  expect(posts()).toHaveLength(1);
});

it.each(["revision", "source denomination"] as const)("refreshes a refused stale %s without silently resubmitting changed terms", async refusal => {
  rows = [{ ...plan }];
  write = async () => {
    rows = refusal === "revision" ? [{ ...plan, amount: "20.00", authorizationRevision: 8 }]
      : [{ ...plan, permittedActions: ["deactivate"] }];
    if (refusal === "source denomination") mocks.currency = "ZMW";
    throw Object.assign(new Error(refusal === "revision" ? "Recurring investment revision changed" : "Investment source denomination changed"),
      { status: 409, code: "CONFLICT" });
  };
  const user = userEvent.setup(); mount(<RecurringInvestmentSetup />);
  await user.click(await reviewAuthorization(user));
  await waitFor(() => expect(posts()).toHaveLength(1));
  await waitFor(() => expect(reads().length).toBeGreaterThan(1));
  expect(await screen.findByRole("alert")).toHaveTextContent(/changed|refresh|review/i);
  if (refusal === "revision") expect((await screen.findAllByText(/USD\s*20\.00|20\.00\s*USD/))[0]).toBeVisible();
  else {
    expect(screen.queryByRole("button", { name: authorizeButton })).toBeNull();
    expect(await screen.findByRole("button", { name: deactivateButton })).toBeEnabled();
  }
  expect(posts()).toHaveLength(1);
  expect(posts()[0].body).toMatchObject({ expectedRevision: 7, amount: "10.00", currency: "USD" });
});

it("keeps stale authorization disabled until the conflict refresh loads current terms", async () => {
  const refusal = deferred(), refresh = deferred();
  const current = { ...plan, authorizationRevision: 8, amount: "20.00", authorizationInitialExecutionDate: "2030-02-20" };
  rows = [plan];
  write = () => refusal.promise;
  const user = userEvent.setup();
  mount(<RecurringInvestmentSetup />);
  const confirm = await reviewAuthorization(user);
  expectDisplayedTerms(confirm, plan.authorizationInitialExecutionDate!);
  const dialog = within(screen.getByRole("dialog", { name: "Recurring plan details" }));

  read = () => refresh.promise;
  await user.click(confirm);
  await waitFor(() => expect(posts()).toHaveLength(1));
  const mutation = capturePendingMutation(mocks.lifetime!.client);
  await act(async () => refusal.reject(Object.assign(new Error("Recurring investment revision changed"), {
    status: 409, code: "CONFLICT",
  })));
  await waitFor(() => expect(reads()).toHaveLength(2));
  expect(mutation.state.status).toBe("error");
  expect(dialog.getByText("USD 10.00")).toBeVisible();
  const staleConfirm = dialog.getByRole("button", { name: authorizeButton });
  expect(staleConfirm).toBeDisabled();
  await user.click(staleConfirm);
  expect(posts()).toHaveLength(1);

  await act(async () => refresh.resolve(json([current])));
  expect(await dialog.findByText("USD 20.00")).toBeVisible();
  expect(dialog.getByText(current.authorizationInitialExecutionDate)).toBeVisible();
  const currentConfirm = dialog.getByRole("button", { name: authorizeButton });
  await waitFor(() => expect(currentConfirm).toBeEnabled());
  expect(posts()).toHaveLength(1);

  read = async () => json(rows);
  write = async () => {
    rows = [{ ...current, authorizationRevision: 9 }];
    return json(rows[0]);
  };
  await user.click(currentConfirm);
  await waitFor(() => expect(posts()).toHaveLength(2));
  expect(posts()[1].body).toMatchObject({ operationId: expect.stringMatching(uuid), expectedRevision: 8,
    amount: "20.00", initialExecutionDate: current.authorizationInitialExecutionDate });
  expect(posts()[1].body?.operationId).not.toBe(posts()[0].body?.operationId);
});

it("refreshes an inactive recurring list after a pre-refusal read settles", async () => {
  const refusal = deferred(), staleRead = deferred();
  const current = { ...plan, authorizationRevision: 8, amount: "20.00" };
  const client = mocks.lifetime!.client, queryKey = investmentKeys.recurring();
  rows = [plan];
  write = () => refusal.promise;
  const user = userEvent.setup();
  mount(<RecurringTabs />);
  await user.click(await reviewAuthorization(user));
  await waitFor(() => expect(posts()).toHaveLength(1));
  const mutation = capturePendingMutation(client);

  read = () => staleRead.promise;
  let firstRefresh: Promise<void> | undefined;
  await act(async () => { firstRefresh = client.invalidateQueries({ queryKey, exact: true }); });
  await waitFor(() => expect(reads()).toHaveLength(2));
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("tab", { name: "Other investments" }));
  expect(client.getQueryCache().find({ queryKey, exact: true })?.getObserversCount()).toBe(0);
  await act(async () => refusal.reject(Object.assign(new Error("Recurring investment revision changed"), {
    status: 409, code: "CONFLICT",
  })));
  await waitFor(() => expect(mutation.state.status).toBe("error"));

  read = async () => json([current]);
  await act(async () => {
    staleRead.resolve(json([plan]));
    await firstRefresh;
  });
  await waitFor(() => expect(reads()).toHaveLength(3));
  await user.click(screen.getByRole("tab", { name: "Recurring" }));
  await openDetails(user);
  const dialog = within(screen.getByRole("dialog", { name: "Recurring plan details" }));
  expect(await dialog.findByText("USD 20.00")).toBeVisible();
  expect(dialog.queryByText("USD 10.00")).toBeNull();
  expect(posts()).toHaveLength(1);
});

it("retries an uncertain authorization exactly and accepts the replay's advanced current server state", async () => {
  const current: PlanDto = { ...plan, nextExecutionDate: "2033-07-20", authorizationRevision: 11,
    isActive: false, authorizationStatus: "inactive", permittedActions: ["authorize"] };
  rows = [{ ...plan }];
  let attempt = 0;
  write = async () => {
    rows = [current];
    if (++attempt === 1) throw new TypeError("Synthetic authorization acknowledgement lost after server acceptance");
    return json(current);
  };
  const user = userEvent.setup(); mount(<RecurringInvestmentSetup />);
  await user.click(await reviewAuthorization(user));
  await waitFor(() => expect(posts()).toHaveLength(1));
  const original = posts()[0];
  await user.click(await screen.findByRole("button", { name: retryButton }));
  await waitFor(() => expect(posts()).toHaveLength(2));
  expect(posts()[1].body).toEqual(original.body);
  expect(posts()[1].serializedBody).toBe(original.serializedBody);
  expect((await screen.findAllByText(/^inactive$/i))[0]).toBeVisible();
  expectDisplayedDate("2033-07-20");
  expect(screen.queryByRole("button", { name: retryButton })).toBeNull();
  expect(posts()[1].body).toMatchObject({ expectedRevision: 7, initialExecutionDate: "2030-01-20" });
});

it("requests the recurring GET again when Retry is activated and replaces the read error with real data", async () => {
  let attempt = 0;
  read = async () => { if (++attempt === 1) throw new Error("Synthetic recurring source unavailable"); return json([plan]); };
  const user = userEvent.setup(); mount(<RecurringInvestmentSetup />);
  await waitFor(() => expect(reads()).toHaveLength(1));
  const retry = await screen.findByRole("button", { name: /retry|try again/i });
  await user.click(retry);
  await waitFor(() => expect(reads()).toHaveLength(2));
  expect(await screen.findByRole("button", { name: /Details|Review.*plan/i })).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/No active automations|No recurring plans/i)).toBeNull();
  expect(posts()).toEqual([]);
});

it("starts Details on the review heading and keeps plan refresh available inside the modal", async () => {
  rows = [{ ...plan }];
  mocks.archivedOnly = true;
  const user = userEvent.setup();
  mount(<RecurringInvestmentSetup />);
  const details = await screen.findByRole("button", { name: "Details" });
  expect(mocks.accountRead).not.toHaveBeenCalled();
  details.focus();
  await user.keyboard("{Enter}");
  const dialog = within(screen.getByRole("dialog", { name: "Recurring plan details" }));
  expect(dialog.getByRole("heading", { name: "Recurring plan details" })).toHaveFocus();
  expect(mocks.accountRead).toHaveBeenCalledWith({ includeArchived: true, includeHidden: true });
  expect(dialog.getByText("Archived synthetic custody")).toBeVisible();

  read = async () => { throw new Error("Synthetic refresh failure"); };
  await act(async () => {
    await mocks.lifetime!.client.invalidateQueries({ queryKey: investmentKeys.recurring() });
  });
  expect(await dialog.findByRole("alert")).toHaveTextContent(/could not be refreshed/i);
  expect(dialog.getByRole("button", { name: authorizeButton })).toBeDisabled();
  const failedReadCount = reads().length;
  rows = [{ ...plan, amount: "11.00" }];
  read = async () => json(rows);
  await user.click(dialog.getByRole("button", { name: "Retry plan refresh" }));
  expect(await dialog.findByText("USD 11.00")).toBeVisible();
  expect(reads()).toHaveLength(failedReadCount + 1);
  expect(dialog.queryByRole("alert")).toBeNull();
  expect(dialog.getByRole("button", { name: authorizeButton })).toBeEnabled();
  expect(posts()).toEqual([]);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(details).toHaveFocus());
});

it.each(["create", "authorize"] as const)("keeps the original %s command when an uncertain replay is refused", async kind => {
  let attempt = 0;
  const acknowledged = { ...plan, nextExecutionDate: "2033-01-20", authorizationRevision: 9 };
  write = async () => {
    attempt++;
    if (attempt === 1) throw new TypeError("Synthetic acknowledgement lost");
    if (attempt === 2) throw Object.assign(new Error("Synthetic source temporarily unavailable"), {
      status: 409, code: "CONFLICT",
    });
    rows = [acknowledged];
    return json(acknowledged);
  };
  const onSuccess = vi.fn();
  const user = userEvent.setup();
  if (kind === "create") {
    mount(<AddRecurringInvestmentForm onSuccess={onSuccess} />);
    await fillCreate(user);
    await submitCreate(user);
  } else {
    rows = [{ ...plan }];
    mount(<RecurringInvestmentSetup />);
    await user.click(await reviewAuthorization(user));
    await waitFor(() => expect(posts()).toHaveLength(1));
  }
  const original = posts()[0];
  expect(original.body?.operationId).toEqual(expect.stringMatching(uuid));
  await user.click(await screen.findByRole("button", { name: retryButton }));
  const exactRetry = await screen.findByRole("button", { name: retryButton });
  expect(posts()).toHaveLength(2);
  expect(onSuccess).not.toHaveBeenCalled();
  if (kind === "create") expect(screen.getByLabelText(/^Amount/)).toBeDisabled();
  await user.click(exactRetry);
  if (kind === "create") await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  else await waitFor(() => expectDisplayedDate(acknowledged.nextExecutionDate, screen.getByRole("dialog")));
  expect(posts()).toHaveLength(3);
  expect(posts().map(post => post.serializedBody)).toEqual(Array(3).fill(original.serializedBody));
});
