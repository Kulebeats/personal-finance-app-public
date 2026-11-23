import { webcrypto } from "node:crypto";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import {
  activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime,
} from "@/lib/operation-lifetime";
import { useSipOccurrenceCommands, useSipOccurrences } from "../useSipOccurrences";
import {
  acknowledgment, cacheText, closedFence, closedOccurrence, confirmationDraft, deferred, ids,
  jsonResponse, listEnvelope, pendingOccurrence, privateReference, scheduledDate, type ConfirmationBody,
} from "./sipOccurrenceTestFixtures";

// Test-first source preparation; production API/hook modules are absent at the
// test-only commit and no run result is claimed. Real hooks, transport adapter,
// decoder, QueryClient and lifetime run against controlled fetch/session/toasts.
// This is mocked client evidence, not signed HTTP, persistence, browser or E2E.
const mocks = vi.hoisted(() => ({
  lifetime: null as { key: string; client: QueryClient; operation: OperationLifetime } | null,
  role: "member",
  toast: vi.fn(),
  boundaryToast: vi.fn(),
}));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: mocks.lifetime?.operation.expectations?.subject },
    household: { id: mocks.lifetime?.operation.expectations?.household, role: mocks.role } },
  lifetime: mocks.lifetime,
}) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.boundaryToast } }));

interface RequestRecord { method: string; path: string; body?: string }
const listPath = `/api/investments/recurring/${ids.plan}/occurrences`;
let requests: RequestRecord[];
let clients: QueryClient[];
let rows: unknown[];
let write: (request: RequestRecord) => Promise<Response>;
let read: () => Promise<Response>;
let releasePending: Array<() => void>;

function scope(subject = ids.subject, household = ids.household) {
  if (mocks.lifetime) {
    retireOperationLifetime(mocks.lifetime.operation);
    retireDataClient(mocks.lifetime.client);
  }
  const operation = createOperationLifetime({ subject, household });
  activateOperationLifetime(operation);
  const client = createDataQueryClient(undefined, operation);
  clients.push(client);
  mocks.lifetime = { key: String(operation.id), client, operation };
}
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={mocks.lifetime!.client}>{children}</QueryClientProvider>;
}
function mount() {
  return renderHook(() => {
    const query = useSipOccurrences(ids.plan, { state: "all", limit: 25 });
    // React Query re-renders only for result fields read during render. Read the
    // error state here, as SipOccurrenceList does, so a failed refetch reaches the view.
    void query.isError;
    return { query, commands: useSipOccurrenceCommands() };
  }, { wrapper });
}
function posts() { return requests.filter(request => request.method === "POST"); }
function body(request = posts()[0]): ConfirmationBody {
  return JSON.parse(request.body!) as ConfirmationBody;
}
function heldResponse() {
  const held = deferred<Response>();
  releasePending.push(() => held.resolve(jsonResponse(listEnvelope([]))));
  return held;
}
function assertOpaqueCache(client = mocks.lifetime!.client) {
  const mutations = client.getMutationCache().getAll();
  for (const mutation of mutations) {
    expect(mutation.state.variables).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i),
      planId: ids.plan,
      scheduledDate: expect.stringMatching(/^2030-(?:01|02)-20$/),
    });
    expect(Object.keys(mutation.state.variables as object).sort()).toEqual(["id", "planId", "scheduledDate"]);
  }
  const cache = cacheText({
    mutations: mutations.map(mutation => ({ variables: mutation.state.variables, context: mutation.state.context,
      data: mutation.state.data, error: mutation.state.error, failureReason: mutation.state.failureReason,
      key: mutation.options.mutationKey, meta: mutation.options.meta })),
    queries: client.getQueryCache().getAll().map(query => ({ key: query.queryKey, meta: query.meta,
      data: query.state.data, error: query.state.error, failureReason: query.state.fetchFailureReason })),
  });
  expect(cache).not.toContain(privateReference);
  expect(cache).not.toContain(JSON.stringify(privateReference).slice(1, -1));
  expect(cacheText(mutations.map(mutation => ({ variables: mutation.state.variables,
    context: mutation.state.context, data: mutation.state.data })))).not.toContain("brokerReference");
}
async function ready(view: ReturnType<typeof mount>) {
  await waitFor(() => expect(view.result.current.query.data?.data).toEqual(rows));
}
beforeEach(() => {
  requests = [];
  clients = [];
  rows = [pendingOccurrence()];
  releasePending = [];
  mocks.role = "member";
  mocks.toast.mockReset();
  mocks.boundaryToast.mockReset();
  clearCsrfToken();
  vi.stubGlobal("crypto", webcrypto);
  read = async () => jsonResponse(listEnvelope(rows));
  write = async request => jsonResponse(acknowledgment(body(request).operationId));
  scope();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = String(input);
    if (raw === "/api/csrf-token") return jsonResponse({ csrfToken: "synthetic-csrf" });
    const url = new URL(raw, "https://synthetic.invalid");
    const method = init?.method ?? "GET";
    const request = { method, path: url.pathname, body: typeof init?.body === "string" ? init.body : undefined };
    requests.push(request);
    if (method === "GET" && url.pathname === listPath) {
      const entries = [...url.searchParams.entries()];
      if (entries.some(([key]) => !["state", "limit", "before"].includes(key))) throw new Error("Unexpected list query key");
      return read();
    }
    if (method === "POST" && [scheduledDate, "2030-02-20"].some(date => url.pathname === `${listPath}/${date}/confirm`)) {
      return write(request);
    }
    throw new Error(`Unexpected occurrence transport: ${method} ${url.pathname}`);
  }));
});
afterEach(async () => {
  cleanup();
  retireOperationLifetime(mocks.lifetime?.operation);
  clients.forEach(retireDataClient);
  await act(async () => releasePending.forEach(release => release()));
  mocks.lifetime = null;
  clearCsrfToken();
  vi.unstubAllGlobals();
});

it("invalidates already-cached account and goal values only after verified financial success", async () => {
  const view = mount();
  await ready(view);
  const client = mocks.lifetime!.client;
  const accountKey = ["accounts", "summary"];
  const goalKey = ["goals", "detail", "holding-backed-goal"];
  client.setQueryData(accountKey, { total: "before-fill" });
  client.setQueryData(goalKey, { progress: "before-fill" });
  client.setQueryData(["unrelated", "metadata"], { unchanged: true });
  await act(async () => {
    expect(await view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(true);
  });
  expect(client.getQueryState(accountKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(goalKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(["unrelated", "metadata"])?.isInvalidated).toBe(false);
});

it("does not invalidate dependent financial caches after validation refuses the fill", async () => {
  const view = mount();
  await ready(view);
  const client = mocks.lifetime!.client;
  const keys = [["accounts", "summary"], ["goals", "detail", "holding-backed-goal"]];
  keys.forEach(key => client.setQueryData(key, { unchanged: true }));
  write = async () => jsonResponse({ success: false, error: { code: "VALIDATION_ERROR",
    message: privateReference, fields: [{ field: "fills.0.executionDate", message: privateReference }],
  } }, 400);
  await act(async () => {
    expect(await view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(false);
  });
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(view.result.current.commands.fields).toEqual({
    "fills.0.executionDate": ["Enter a real execution date in YYYY-MM-DD format"],
  });
  expect(cacheText(client.getMutationCache().getAll().map(mutation => mutation.state.error))).not.toContain(privateReference);
});

it("synchronously admits one immutable command and keeps raw reference out of mutation variables/context/data", async () => {
  const held = heldResponse();
  write = () => held.promise;
  const view = mount();
  await ready(view);
  const draft = confirmationDraft();
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  act(() => {
    first = view.result.current.commands.confirm(pendingOccurrence(), draft);
    second = view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft());
    draft.fills[0].quantity = "9.00000000";
    draft.brokerReference = "CHANGED-AFTER-ADMISSION";
  });
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(await second).toBe(false);
  expect(body()).toMatchObject({ expectedRevision: 0, brokerReference: privateReference,
    fills: [{ quantity: "1.25000000" }, { quantity: "0.50000000" }] });
  expect(body().operationId).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
  assertOpaqueCache();
  await act(async () => {
    held.reject(new TypeError("Synthetic response lost"));
    expect(await first).toBe(false);
  });
  expect(view.result.current.commands.uncertain).toBe(true);
  expect(view.result.current.commands.draft?.terms.brokerReference).toBe(privateReference);
  assertOpaqueCache();
});

it("remounts an uncertain original draft and retries its exact serialized body without another admission", async () => {
  let attempt = 0;
  write = async request => {
    if (++attempt === 1) throw new TypeError("Synthetic accepted response lost");
    rows = [closedOccurrence()];
    return jsonResponse(acknowledgment(body(request).operationId));
  };
  const first = mount();
  await ready(first);
  await act(async () => { expect(await first.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(false); });
  const original = posts()[0].body;
  first.unmount();
  const second = mount();
  await waitFor(() => expect(second.result.current.commands.uncertain).toBe(true));
  expect(second.result.current.commands.draft?.terms.brokerReference).toBe(privateReference);
  assertOpaqueCache();
  await act(async () => { expect(await second.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(false); });
  expect(posts()).toHaveLength(1);
  await act(async () => { expect(await second.result.current.commands.retry()).toBe(true); });
  expect(posts().map(request => request.body)).toEqual([original, original]);
  expect(second.result.current.commands.draft).toBeNull();
  expect(mocks.toast).toHaveBeenCalledTimes(1);
  assertOpaqueCache();
});

it("retains uncertain original intent after a refused replay instead of replacing its key or reference", async () => {
  let attempt = 0;
  write = async request => {
    attempt++;
    if (attempt === 1) throw new TypeError("Synthetic response lost");
    if (attempt === 2) return jsonResponse({ success: false, error: { code: "CONFLICT", message: "Review current source" } }, 409);
    rows = [closedOccurrence()];
    return jsonResponse(acknowledgment(body(request).operationId));
  };
  const view = mount();
  await ready(view);
  await act(async () => { await view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft()); });
  await act(async () => { expect(await view.result.current.commands.retry()).toBe(false); });
  expect(view.result.current.commands.uncertain).toBe(true);
  expect(view.result.current.commands.draft?.terms.brokerReference).toBe(privateReference);
  await act(async () => { expect(await view.result.current.commands.retry()).toBe(true); });
  expect(posts()).toHaveLength(3);
  expect(new Set(posts().map(request => request.body)).size).toBe(1);
  assertOpaqueCache();
});

it("keeps the original draft and operation on the explicit household-calendar hold without false success", async () => {
  let held = true;
  write = async request => {
    if (held) return jsonResponse({ success: false, error: { code: "HOUSEHOLD_CALENDAR_REQUIRED",
      message: "Confirmation is unavailable until the household calendar is configured." } }, 409);
    rows = [closedOccurrence()];
    return jsonResponse(acknowledgment(body(request).operationId));
  };
  const view = mount();
  await ready(view);
  await act(async () => { expect(await view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(false); });
  const original = posts()[0].body;
  expect(view.result.current.commands.message).toBe("Confirmation is unavailable until the household calendar is configured.");
  expect(view.result.current.commands.draft?.terms.brokerReference).toBe(privateReference);
  expect(mocks.toast).not.toHaveBeenCalled();
  expect(posts()).toHaveLength(1);
  assertOpaqueCache();
  held = false;
  await act(async () => { expect(await view.result.current.commands.retry()).toBe(true); });
  expect(posts().map(request => request.body)).toEqual([original, original]);
});

it("keeps reference-bearing server failures out of mutation and query errors while retaining the owned original retry", async () => {
  let attempt = 0;
  write = async request => {
    if (++attempt === 1) return jsonResponse({ success: false, error: { code: "INTERNAL_ERROR",
      message: privateReference, details: { reference: privateReference }, fields: { brokerReference: [privateReference] } } }, 500);
    rows = [closedOccurrence()];
    return jsonResponse(acknowledgment(body(request).operationId));
  };
  const view = mount();
  await ready(view);
  await act(async () => { expect(await view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(false); });
  expect(view.result.current.commands.draft?.terms.brokerReference).toBe(privateReference);
  const original = posts()[0].body;
  assertOpaqueCache();
  read = async () => jsonResponse({ success: false, error: { code: "INTERNAL_ERROR", message: privateReference,
    details: { reference: privateReference } } }, 500);
  await act(async () => { await mocks.lifetime!.client.invalidateQueries(); });
  await waitFor(() => expect(view.result.current.query.isError).toBe(true));
  assertOpaqueCache();
  expect(cacheText(mocks.boundaryToast.mock.calls)).not.toContain(privateReference);
  read = async () => jsonResponse(listEnvelope(rows));
  await act(async () => { expect(await view.result.current.commands.retry()).toBe(true); });
  expect(posts().map(request => request.body)).toEqual([original, original]);
  assertOpaqueCache();
});

it("lets a verified minimal-fence read retire intent and prevents a held old acknowledgment restoring details", async () => {
  const held = heldResponse();
  write = () => held.promise;
  const view = mount();
  await ready(view);
  let completion!: Promise<boolean>;
  act(() => { completion = view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft()); });
  await waitFor(() => expect(posts()).toHaveLength(1));
  const originalOperation = body().operationId;
  rows = [closedFence()];
  await act(async () => { await mocks.lifetime!.client.invalidateQueries(); });
  await waitFor(() => expect(view.result.current.commands.draft).toBeNull());
  expect(view.result.current.commands.pending).toBeNull();
  expect(view.result.current.commands.uncertain).toBe(false);
  assertOpaqueCache();
  await act(async () => {
    held.resolve(jsonResponse(acknowledgment(originalOperation)));
    expect(await completion).toBe(false);
  });
  expect(view.result.current.query.data?.data).toEqual([closedFence()]);
  const cache = cacheText({ queries: mocks.lifetime!.client.getQueryCache().getAll().map(query => query.state.data),
    mutations: mocks.lifetime!.client.getMutationCache().getAll().map(mutation => mutation.state) });
  expect(cache).not.toContain(privateReference);
  expect(cache).not.toContain(closedOccurrence().result.fills[0].purchaseId);
  expect(cache).not.toContain("grossAmount");
  expect(mocks.toast).not.toHaveBeenCalled();
  await act(async () => { expect(await view.result.current.commands.retry()).toBe(false); });
  expect(posts()).toHaveLength(1);
});

it("handles the authorized special 409 as a minimal closed fence with no purchase-success claim", async () => {
  write = async () => {
    rows = [closedFence()];
    return jsonResponse({ success: false, error: { code: "OCCURRENCE_CLOSED_DETAILS_UNAVAILABLE",
      message: "This occurrence is closed; execution details are unavailable." } }, 409);
  };
  const view = mount();
  await ready(view);
  await act(async () => { expect(await view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(false); });
  await waitFor(() => expect(view.result.current.query.data?.data).toEqual([closedFence()]));
  expect(view.result.current.commands.draft).toBeNull();
  expect(view.result.current.commands.uncertain).toBe(false);
  assertOpaqueCache();
  expect(mocks.toast).not.toHaveBeenCalled();
  await act(async () => { expect(await view.result.current.commands.retry()).toBe(false); });
  expect(posts()).toHaveLength(1);
});

it("does not let an old retired occurrence response replace a newer occurrence's draft", async () => {
  const old = heldResponse();
  const next = heldResponse();
  const newer = { ...pendingOccurrence(), scheduledDate: "2030-02-20" };
  rows = [newer, pendingOccurrence()];
  write = request => request.path.includes(scheduledDate) ? old.promise : next.promise;
  const view = mount();
  await ready(view);
  let previous!: Promise<boolean>;
  act(() => { previous = view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft()); });
  await waitFor(() => expect(posts()).toHaveLength(1));
  const oldOperation = body().operationId;
  rows = [newer, closedFence()];
  await act(async () => { await mocks.lifetime!.client.invalidateQueries(); });
  await waitFor(() => expect(view.result.current.commands.pending).toBeNull());
  const newDraft = { ...confirmationDraft(), brokerReference: "SYNTHETIC-NEWER-REFERENCE" };
  let current!: Promise<boolean>;
  act(() => { current = view.result.current.commands.confirm(newer, newDraft); });
  await waitFor(() => expect(posts()).toHaveLength(2));
  await act(async () => {
    old.resolve(jsonResponse(acknowledgment(oldOperation)));
    expect(await previous).toBe(false);
  });
  expect(view.result.current.commands.pending).toMatchObject({ scheduledDate: newer.scheduledDate });
  expect(view.result.current.commands.draft?.terms.brokerReference).toBe(newDraft.brokerReference);
  await act(async () => {
    next.reject(new TypeError("Synthetic newer response lost"));
    expect(await current).toBe(false);
  });
  expect(view.result.current.commands.uncertain).toBe(true);
  expect(posts()).toHaveLength(2);
});

it("withdraws an erased or switched lifetime and rejects late publication into its replacement", async () => {
  const held = heldResponse();
  write = () => held.promise;
  const first = mount();
  await ready(first);
  let completion!: Promise<boolean>;
  act(() => { completion = first.result.current.commands.confirm(pendingOccurrence(), confirmationDraft()); });
  await waitFor(() => expect(posts()).toHaveLength(1));
  const originalOperation = body().operationId;
  const retired = mocks.lifetime!;
  first.unmount();
  scope(ids.otherSubject, ids.otherHousehold);
  rows = [];
  const replacement = mount();
  await ready(replacement);
  await act(async () => {
    held.resolve(jsonResponse(acknowledgment(originalOperation)));
    expect(await completion).toBe(false);
  });
  expect(retired.client.getQueryCache().getAll()).toEqual([]);
  expect(retired.client.getMutationCache().getAll()).toEqual([]);
  expect(replacement.result.current.commands.draft).toBeNull();
  expect(replacement.result.current.commands.pending).toBeNull();
  expect(mocks.toast).not.toHaveBeenCalled();
  assertOpaqueCache();
});

it.each([403, 404, 409])("refreshes a definitive %s refusal without silently submitting different intent", async status => {
  const codes = { 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT" };
  write = async () => {
    rows = [];
    return jsonResponse({ success: false, error: { code: codes[status as keyof typeof codes], message: "Review current access" } }, status);
  };
  const view = mount();
  await ready(view);
  await act(async () => { expect(await view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(false); });
  await waitFor(() => expect(view.result.current.query.data?.data).toEqual([]));
  expect(posts()).toHaveLength(1);
  expect(view.result.current.commands.message).toMatch(/review|access|changed|available/i);
  expect(mocks.toast).not.toHaveBeenCalled();
  assertOpaqueCache();
});

it("uses occurrence actions and revision instead of requiring active future plan terms", async () => {
  const view = mount();
  await ready(view);
  await act(async () => { expect(await view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(true); });
  expect(body().expectedRevision).toBe(0);
  expect(body()).not.toHaveProperty("authorizationRevision");
  expect(body()).not.toHaveProperty("isActive");
  expect(body()).not.toHaveProperty("nextExecutionDate");
  expect(body()).not.toHaveProperty("accountId");
  expect(body()).not.toHaveProperty("securityId");
});

it("rejects missing server permission after an independently permitted successful baseline", async () => {
  const view = mount();
  await ready(view);
  expect(view.result.current.query.data?.data[0]).toEqual(pendingOccurrence());
  rows = [{ ...pendingOccurrence(), permittedActions: [] }];
  await act(async () => { await mocks.lifetime!.client.invalidateQueries(); });
  await ready(view);
  await act(async () => { expect(await view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(false); });
  expect(posts()).toHaveLength(0);
});

it("rejects a failed current read after an independently permitted successful baseline", async () => {
  const view = mount();
  await ready(view);
  expect(view.result.current.query.data?.data[0]).toEqual(pendingOccurrence());
  read = async () => { throw new TypeError("Synthetic occurrence list unavailable"); };
  await act(async () => { await mocks.lifetime!.client.invalidateQueries(); });
  await waitFor(() => expect(view.result.current.query.isError).toBe(true));
  expect(view.result.current.query.data?.data[0]).toEqual(pendingOccurrence());
  await act(async () => { expect(await view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(false); });
  expect(posts()).toHaveLength(0);
});

it("rejects an unknown role while its independently permitted successful read remains current", async () => {
  const view = mount();
  await ready(view);
  expect(view.result.current.query.isSuccess).toBe(true);
  expect(view.result.current.query.data?.data[0]).toEqual(pendingOccurrence());
  mocks.role = "unrecognized";
  view.rerender();
  await act(async () => { expect(await view.result.current.commands.confirm(pendingOccurrence(), confirmationDraft())).toBe(false); });
  expect(posts()).toHaveLength(0);
});
