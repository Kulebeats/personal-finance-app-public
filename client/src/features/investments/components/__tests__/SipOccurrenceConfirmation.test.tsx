import { webcrypto } from "node:crypto";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { SipOccurrenceList } from "../SipOccurrenceList";
import {
  acknowledgment, actualFills, closedFence, closedOccurrence, deferred, ids, jsonResponse,
  listEnvelope, pendingOccurrence, privateReference, scheduledDate, type ConfirmationBody,
} from "@/hooks/investments/__tests__/sipOccurrenceTestFixtures";

// Real list/editor/API/hook/lifetime; controlled fetch, session and toast only.
// Authored before components, unrun under Main scheduling. Mocked client evidence.
const mocks = vi.hoisted(() => ({
  lifetime: null as { key: string; client: QueryClient; operation: OperationLifetime } | null,
  toast: vi.fn(),
}));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: ids.subject }, household: { id: ids.household, role: "member" } },
  lifetime: mocks.lifetime,
}) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
let rows: unknown[];
let posts: ConfirmationBody[];
let respond: (body: ConfirmationBody) => Promise<Response>;
let readOccurrence: (state: string) => Promise<Response>;
let reads: string[];
let releasePending: Array<() => void>;
beforeEach(() => {
  rows = [pendingOccurrence()];
  posts = [];
  reads = [];
  releasePending = [];
  mocks.toast.mockReset();
  clearCsrfToken();
  vi.stubGlobal("crypto", webcrypto);
  const operation = createOperationLifetime({ subject: ids.subject, household: ids.household });
  activateOperationLifetime(operation);
  mocks.lifetime = { key: String(operation.id), client: createDataQueryClient(undefined, operation), operation };
  respond = async body => {
    const closed = closedOccurrence();
    if (body.outcome === "unfilled") closed.result = {
      outcome: "unfilled", fills: [], totals: { grossAmount: "0.00", fees: "0.00", amount: "0.00" },
    };
    rows = [closed];
    return jsonResponse(acknowledgment(body.operationId, closed));
  };
  readOccurrence = async state => jsonResponse(listEnvelope(rows.filter(row =>
    state === "all" || (row as { state: string }).state === state)));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input);
    if (raw === "/api/csrf-token") return jsonResponse({ csrfToken: "synthetic-csrf" });
    const url = new URL(raw, "https://synthetic.invalid");
    if ((!init?.method || init.method === "GET") && url.pathname === "/api/investments/calendar" && !url.search) {
      return jsonResponse({ success: true, data: { timeZone: "Africa/Lusaka", configured: true, permittedActions: [] } });
    }
    const base = `/api/investments/recurring/${ids.plan}/occurrences`;
    if ((!init?.method || init.method === "GET") && url.pathname === base) {
      const state = url.searchParams.get("state") ?? "all";
      reads.push(state);
      return readOccurrence(state);
    }
    if (init?.method === "POST" && url.pathname === `${base}/${scheduledDate}/confirm`) {
      const body = JSON.parse(String(init.body)) as ConfirmationBody;
      posts.push(body);
      return respond(body);
    }
    throw new Error(`Unexpected component transport: ${init?.method ?? "GET"} ${url.pathname}`);
  }));
});
afterEach(() => {
  cleanup();
  retireOperationLifetime(mocks.lifetime?.operation);
  if (mocks.lifetime) retireDataClient(mocks.lifetime.client);
  releasePending.forEach(release => release());
  mocks.lifetime = null;
  clearCsrfToken();
  vi.unstubAllGlobals();
});
function mount() {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={mocks.lifetime!.client}>{children}</QueryClientProvider>;
  return render(<SipOccurrenceList planId={ids.plan} />, { wrapper: Wrapper });
}
async function open() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: `Review final statement for ${scheduledDate}` }));
  return user;
}
function fillRow(index: number, fill = actualFills[index - 1]) {
  for (const [field, value] of Object.entries(fill)) {
    const labels = { executionDate: "execution date", quantity: "quantity", price: "price", fees: "fees" };
    fireEvent.change(screen.getByLabelText(new RegExp(`^Fill ${index} ${labels[field as keyof typeof labels]}`)), { target: { value } });
  }
}
async function completeTwoFills(user: ReturnType<typeof userEvent.setup>) {
  fillRow(1);
  await user.click(screen.getByRole("button", { name: "Add actual fill" }));
  fillRow(2);
  await user.selectOptions(screen.getByLabelText("Final order outcome"), "partially_filled");
  fireEvent.change(screen.getByLabelText("Broker reference (optional)"), { target: { value: privateReference } });
  await user.click(screen.getByLabelText("I have the final broker statement"));
}

it("shows pending and blank actual facts without claiming an order or cash movement", async () => {
  mount();
  const user = await open();
  expect(screen.getByText(/Pending final broker statement/i)).toBeVisible();
  expect(screen.getByLabelText(/^Fill 1 execution date/)).toHaveValue("");
  expect(screen.getByLabelText(/^Fill 1 quantity/)).toHaveValue("");
  expect(screen.getByLabelText(/^Fill 1 price/)).toHaveValue("");
  expect(screen.getByLabelText(/^Fill 1 fees/)).toHaveValue("");
  expect(screen.getByRole("button", { name: "Record final statement" })).toBeDisabled();
  expect(screen.getByText(/does not place broker orders or move cash/i)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Back to scheduled purchases" }));
  expect(posts).toEqual([]);
});

it("records every actual fill separately and shows planned versus actual without rewriting the plan", async () => {
  mount();
  const user = await open();
  await completeTwoFills(user);
  expect(screen.getByText(/5\.22/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Record final statement" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].fills).toEqual(actualFills);
  expect(posts[0]).toMatchObject({ finalStatement: true, outcome: "partially_filled", expectedRevision: 0, brokerReference: privateReference });
  expect(posts[0]).not.toHaveProperty("amount");
  expect(posts[0]).not.toHaveProperty("frequency");
  expect(await screen.findByText("Final partially filled")).toBeVisible();
  expect(screen.getByText("2030-01-19")).toBeVisible();
  expect(screen.getByText("2030-01-21")).toBeVisible();
  expect(screen.getByText(/Future plan terms stay unchanged/i)).toBeVisible();
  expect(screen.queryByText(privateReference)).toBeNull();
});

it("closes an explicitly unfilled final order with no fabricated remainder", async () => {
  mount();
  const user = await open();
  await user.click(screen.getByRole("button", { name: "Remove fill 1" }));
  await user.selectOptions(screen.getByLabelText("Final order outcome"), "unfilled");
  await user.click(screen.getByLabelText("I have the final broker statement"));
  await user.click(screen.getByRole("button", { name: "Record final statement" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].fills).toEqual([]);
  expect(posts[0].outcome).toBe("unfilled");
  expect(await screen.findByText("Final unfilled — no purchases")).toBeVisible();
});

it("resumes the same held request after closing the editor and never announces success", async () => {
  respond = async () => jsonResponse({ success: false, error: { code: "HOUSEHOLD_CALENDAR_REQUIRED",
    message: "Confirmation is unavailable until the household calendar is configured." } }, 409);
  mount();
  const user = await open();
  await completeTwoFills(user);
  await user.click(screen.getByRole("button", { name: "Record final statement" }));
  const original = await screen.findByRole("button", { name: "Retry original confirmation" });
  expect(screen.getByText("Confirmation is unavailable until the household calendar is configured.")).toBeVisible();
  expect(screen.getByLabelText("Broker reference (optional)")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Back to scheduled purchases" }));
  await open();
  expect(screen.getByLabelText("Broker reference (optional)")).toHaveValue(privateReference);
  expect(original.isConnected).toBe(false);
  await user.click(screen.getByRole("button", { name: "Retry original confirmation" }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]).toEqual(posts[0]);
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("renders a refreshed minimal closed fence without retaining reference or inferring zero-fill proof", async () => {
  respond = async () => { throw new TypeError("Synthetic response lost"); };
  mount();
  const user = await open();
  await completeTwoFills(user);
  await user.click(screen.getByRole("button", { name: "Record final statement" }));
  await screen.findByRole("button", { name: "Retry original confirmation" });
  await user.click(screen.getByRole("button", { name: "Back to scheduled purchases" }));
  rows = [closedFence()];
  await user.click(screen.getByRole("button", { name: "Closed" }));
  expect(await screen.findByText("Closed", { selector: "article p" })).toBeVisible();
  expect(reads).toContain("closed");
  expect(screen.queryByLabelText("Broker reference (optional)")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry original confirmation" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume original confirmation" })).toBeNull();
  expect(screen.queryByText(/Final unfilled|no purchases|Actual total/i)).toBeNull();
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("keeps retryable read failures visible but withdraws cached occurrence pages after a custody refusal", async () => {
  const closed = closedOccurrence();
  const upcoming = { ...pendingOccurrence(), scheduledDate: "2030-02-20" };
  rows = [closed, upcoming];
  mount();
  const user = userEvent.setup();
  await screen.findByText(`Scheduled ${upcoming.scheduledDate}`);
  await user.click(screen.getByRole("button", { name: "Closed" }));
  expect(await screen.findByRole("table", { name: "Recorded actual fills" })).toBeVisible();
  expect(screen.getByText("2030-01-19")).toBeVisible();
  expect(screen.getByText("1.25000000")).toBeVisible();
  expect(screen.getByText(/Actual total: USD 5\.22/)).toBeVisible();

  const allowedRead = readOccurrence;
  const networkFailure = async () => { throw new TypeError("Synthetic network interruption"); };
  readOccurrence = networkFailure;
  await act(async () => { await mocks.lifetime!.client.invalidateQueries(); });
  expect(await screen.findByRole("button", { name: "Retry scheduled purchases" })).toBeVisible();
  expect(screen.getByRole("table", { name: "Recorded actual fills" })).toBeVisible();

  readOccurrence = async () => jsonResponse({ success: false, error: {
    code: "NOT_FOUND", message: "Investment occurrence not found",
  } }, 404);
  await act(async () => { await mocks.lifetime!.client.invalidateQueries(); });
  expect(screen.queryByRole("table", { name: "Recorded actual fills" })).toBeNull();
  expect(screen.queryByText(`Scheduled ${closed.scheduledDate}`)).toBeNull();
  expect(screen.queryByText("2030-01-19")).toBeNull();
  expect(screen.queryByText("1.25000000")).toBeNull();
  expect(screen.queryByText(/Actual total: USD 5\.22/)).toBeNull();

  readOccurrence = networkFailure;
  await act(async () => { await mocks.lifetime!.client.invalidateQueries(); });
  expect(screen.queryByRole("table", { name: "Recorded actual fills" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Pending" }));
  expect(screen.queryByText(`Scheduled ${upcoming.scheduledDate}`)).toBeNull();

  readOccurrence = allowedRead;
  const retry = await screen.findByRole("button", { name: "Retry scheduled purchases" });
  await waitFor(() => expect(retry).toBeEnabled());
  await user.click(retry);
  expect(await screen.findByText(`Scheduled ${upcoming.scheduledDate}`)).toBeVisible();
  expect(posts).toEqual([]);
});

it("withdraws the open confirmation and its held detail after a typed read refusal", async () => {
  respond = async () => { throw new TypeError("Synthetic confirmation response lost"); };
  mount();
  const user = await open();
  await completeTwoFills(user);
  await user.click(screen.getByRole("button", { name: "Record final statement" }));
  expect(await screen.findByRole("button", { name: "Retry original confirmation" })).toBeVisible();
  expect(screen.getByRole("form", { name: `Confirm final statement for ${scheduledDate}` })).toBeVisible();
  expect(screen.getByLabelText("Broker reference (optional)")).toHaveValue(privateReference);
  expect(screen.getByText(ids.account)).toBeVisible();

  readOccurrence = async () => jsonResponse({ success: false, error: {
    code: "FORBIDDEN", message: "Financial read access required",
  } }, 403);
  await act(async () => { await mocks.lifetime!.client.invalidateQueries(); });
  expect(await screen.findByRole("button", { name: "Retry scheduled purchases" })).toBeVisible();
  expect(screen.queryByRole("form", { name: `Confirm final statement for ${scheduledDate}` })).toBeNull();
  expect(screen.queryByText(ids.account)).toBeNull();
  expect(screen.queryByLabelText("Broker reference (optional)")).toBeNull();
  expect(screen.queryByRole("button", { name: /original confirmation/i })).toBeNull();
  expect(screen.queryByText(`Scheduled ${scheduledDate}`)).toBeNull();
  expect(posts).toHaveLength(1);
});

it.each(["refusal", "success"] as const)("uses the latest access refusal when an earlier filter returns a late %s", async lateResult => {
  const closed = closedOccurrence();
  const upcoming = { ...pendingOccurrence(), scheduledDate: "2030-02-20" };
  const upcomingLabel = `Scheduled ${upcoming.scheduledDate}`;
  const tableName = { name: "Recorded actual fills" };
  const retryName = { name: "Retry scheduled purchases" };
  rows = [closed, upcoming];
  const pendingView = within(mount().container);
  const closedView = within(mount().container);
  const user = userEvent.setup();
  await user.click(closedView.getByRole("button", { name: "Closed" }));
  expect(await pendingView.findByText(upcomingLabel)).toBeVisible();
  expect(await closedView.findByRole("table", tableName)).toBeVisible();

  const requestStarted = deferred<void>();
  const lateResponse = deferred<Response>();
  const refusal = () => jsonResponse({ success: false, error: { code: "NOT_FOUND", message: "Investment occurrence not found" } }, 404);
  releasePending.push(() => lateResponse.resolve(refusal()));
  const allowedRead = readOccurrence;
  readOccurrence = async state => {
    if (state !== "closed") return refusal();
    requestStarted.resolve();
    return lateResponse.promise;
  };
  const refresh = () => mocks.lifetime!.client.invalidateQueries();
  let overlappingRefresh: Promise<void> | undefined;
  await act(async () => { overlappingRefresh = refresh(); });
  await requestStarted.promise;

  const pendingRetry = await pendingView.findByRole("button", retryName);
  expect(pendingView.queryByText(upcomingLabel)).toBeNull();
  expect(closedView.queryByRole("table", tableName)).toBeNull();
  readOccurrence = allowedRead;
  await user.click(pendingRetry);
  expect(await pendingView.findByText(upcomingLabel)).toBeVisible();

  await act(async () => {
    lateResponse.resolve(lateResult === "refusal" ? refusal() : jsonResponse(listEnvelope([closed])));
    await overlappingRefresh;
  });
  expect(closedView.queryByRole("table", tableName)).toBeNull();
  if (lateResult === "refusal") {
    await waitFor(() => expect(pendingView.queryByText(upcomingLabel)).toBeNull());
    await user.click(await pendingView.findByRole("button", retryName));
    expect(await pendingView.findByText(upcomingLabel)).toBeVisible();
  } else {
    expect(pendingView.getByText(upcomingLabel)).toBeVisible();
    await user.click(await closedView.findByRole("button", retryName));
    expect(await closedView.findByRole("table", tableName)).toBeVisible();
  }
  expect(posts).toEqual([]);
});

it("withholds cached details if the mounted view no longer has its original operation", async () => {
  rows = [closedOccurrence()];
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Closed" }));
  expect(await screen.findByRole("table", { name: "Recorded actual fills" })).toBeVisible();

  const readCount = reads.length;
  await act(async () => { retireOperationLifetime(mocks.lifetime!.operation); });
  expect(screen.queryByRole("table", { name: "Recorded actual fills" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry scheduled purchases" }));
  expect(reads).toHaveLength(readCount);
  expect(posts).toEqual([]);
});

it("resumes an uncertain original request when the refreshed pending list no longer contains its closed occurrence", async () => {
  let attempt = 0;
  respond = async body => {
    rows = [closedOccurrence()];
    if (++attempt === 1) throw new TypeError("Synthetic accepted response lost");
    return jsonResponse(acknowledgment(body.operationId));
  };
  mount();
  const user = await open();
  await completeTwoFills(user);
  await user.click(screen.getByRole("button", { name: "Record final statement" }));
  await screen.findByRole("button", { name: "Retry original confirmation" });
  await act(async () => { await mocks.lifetime!.client.invalidateQueries(); });
  await user.click(screen.getByRole("button", { name: "Back to scheduled purchases" }));
  expect(screen.queryByRole("button", { name: `Review final statement for ${scheduledDate}` })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Resume original confirmation" }));
  expect(screen.getByLabelText("Broker reference (optional)")).toHaveValue(privateReference);
  await user.click(screen.getByRole("button", { name: "Retry original confirmation" }));
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[1]).toEqual(posts[0]);
  expect(await screen.findByText("Final partially filled")).toBeVisible();
});

it("finishes verified success after a deferred pending refresh removes the editor before the child callback resumes", async () => {
  const refresh = deferred<Response>();
  releasePending.push(() => refresh.resolve(jsonResponse(listEnvelope([]))));
  let refreshing = false;
  respond = async body => {
    rows = [closedOccurrence()];
    const ordinaryRead = readOccurrence;
    readOccurrence = state => {
      if (state === "pending") {
        refreshing = true;
        return refresh.promise;
      }
      return ordinaryRead(state);
    };
    return jsonResponse(acknowledgment(body.operationId));
  };
  mount();
  const user = await open();
  await completeTwoFills(user);
  const editor = screen.getByRole("form", { name: `Confirm final statement for ${scheduledDate}` });
  await user.click(screen.getByRole("button", { name: "Record final statement" }));
  await waitFor(() => expect(refreshing).toBe(true));
  expect(screen.getByText("Submitting the original final statement…")).toBeVisible();
  expect(mocks.toast).not.toHaveBeenCalled();
  await act(async () => { refresh.resolve(jsonResponse(listEnvelope([]))); });
  expect(await screen.findByText("Final partially filled")).toBeVisible();
  expect(editor.isConnected).toBe(false);
  expect(screen.queryByText("Submitting the original final statement…")).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume original confirmation" })).toBeNull();
  expect(screen.queryByLabelText("Broker reference (optional)")).toBeNull();
  expect(mocks.toast).toHaveBeenCalledTimes(1);
});
