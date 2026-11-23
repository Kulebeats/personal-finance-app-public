import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { readSipHouseholdCalendar } from "@/hooks/investments/sipOccurrenceApi";
import { SipHouseholdCalendar } from "../SipHouseholdCalendar";
import { ids, jsonResponse, listEnvelope, pendingOccurrence } from "@/hooks/investments/__tests__/sipOccurrenceTestFixtures";

// Additional owner-calendar source oracles; separate from the earlier calendar
// hold tests. Real component/API/hooks, controlled fetch/session. Unrun, mocked.
const mocks = vi.hoisted(() => ({
  lifetime: null as { key: string; client: QueryClient; operation: OperationLifetime } | null,
  role: "owner",
}));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: ids.subject }, household: { id: ids.household, role: mocks.role } },
  lifetime: mocks.lifetime,
}) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
let calendar: { timeZone: string | null; configured: boolean; permittedActions: Array<"configure"> };
let calls: Array<{ method: string; body?: string }>;
let readError: boolean;
let put: (body: { timeZone: string }) => Promise<Response>;
beforeEach(() => {
  mocks.role = "owner";
  calendar = { timeZone: null, configured: false, permittedActions: ["configure"] };
  calls = [];
  readError = false;
  clearCsrfToken();
  const operation = createOperationLifetime({ subject: ids.subject, household: ids.household });
  activateOperationLifetime(operation);
  mocks.lifetime = { key: String(operation.id), client: createDataQueryClient(undefined, operation), operation };
  put = async body => {
    calendar = { timeZone: body.timeZone, configured: true, permittedActions: ["configure"] };
    return jsonResponse({ success: true, data: calendar });
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/csrf-token") return jsonResponse({ csrfToken: "synthetic-csrf" });
    if (url !== "/api/investments/calendar") throw new Error("Unexpected calendar transport");
    const method = init?.method ?? "GET";
    calls.push({ method, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "GET") {
      if (readError) throw new TypeError("Synthetic calendar unavailable");
      return jsonResponse({ success: true, data: calendar });
    }
    if (method === "PUT") return put(JSON.parse(String(init?.body)) as { timeZone: string });
    throw new Error("Unexpected calendar method");
  }));
});
afterEach(() => {
  cleanup();
  retireOperationLifetime(mocks.lifetime?.operation);
  if (mocks.lifetime) retireDataClient(mocks.lifetime.client);
  mocks.lifetime = null;
  clearCsrfToken();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function mount() {
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={mocks.lifetime!.client}>{children}</QueryClientProvider>;
  return render(<SipHouseholdCalendar />, { wrapper: Wrapper });
}

it("keeps an unset calendar unset until the owner explicitly selects a named zone", async () => {
  mount();
  const selector = await screen.findByLabelText("Shared household time zone");
  expect(selector).toHaveValue("");
  expect(screen.getByText(/Household calendar is not configured/i)).toBeVisible();
  expect(screen.getByRole("button", { name: "Save household calendar" })).toBeDisabled();
  expect(calls.filter(call => call.method === "PUT")).toEqual([]);
  const user = userEvent.setup();
  await user.selectOptions(selector, "Africa/Lusaka");
  await user.click(screen.getByRole("button", { name: "Save household calendar" }));
  await waitFor(() => expect(calls.filter(call => call.method === "PUT")).toEqual([
    { method: "PUT", body: JSON.stringify({ timeZone: "Africa/Lusaka" }) },
  ]));
  expect(await screen.findByText("Africa/Lusaka", { selector: "span" })).toBeVisible();
});

it("allows explicit UTC without treating it as an unset-calendar fallback", async () => {
  mount();
  const selector = await screen.findByLabelText("Shared household time zone");
  expect(selector).toHaveValue("");
  const user = userEvent.setup();
  await user.selectOptions(selector, "UTC");
  await user.click(screen.getByRole("button", { name: "Save household calendar" }));
  await waitFor(() => expect(calls.some(call => call.body === JSON.stringify({ timeZone: "UTC" }))).toBe(true));
});

it.each(["admin", "member", "view_only", "professional"])("keeps %s read-only even if a stale permission array says configure", async role => {
  mocks.role = role;
  calendar = { timeZone: "Africa/Lusaka", configured: true, permittedActions: ["configure"] };
  mount();
  expect(await screen.findByText("Africa/Lusaka", { selector: "span" })).toBeVisible();
  expect(screen.queryByLabelText("Shared household time zone")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save household calendar" })).toBeNull();
  expect(calls.filter(call => call.method === "PUT")).toEqual([]);
});

it("keeps the backend-normalized unavailable calendar null and read-only for an ordinary member", async () => {
  mocks.role = "member";
  calendar = { timeZone: null, configured: false, permittedActions: [] };
  mount();
  expect(await screen.findByText(/Household calendar is not configured/i)).toBeVisible();
  expect(screen.queryByLabelText("Shared household time zone")).toBeNull();
  expect(calls.filter(call => call.method === "PUT")).toEqual([]);
});

it("shows a calendar read error separately from unset policy and retries the real read", async () => {
  readError = true;
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not be refreshed/i);
  expect(screen.queryByText(/Household calendar is not configured/i)).toBeNull();
  readError = false;
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry household calendar" }));
  expect(await screen.findByLabelText("Shared household time zone")).toHaveValue("");
  expect(calls.filter(call => call.method === "GET")).toHaveLength(2);
});

it("preserves an explicit rejected choice and shows the safe timeZone field message", async () => {
  put = async () => jsonResponse({ success: false, error: { code: "VALIDATION_ERROR", message: "Review the household calendar",
    fields: { timeZone: ["Select a supported named household time zone"] } } }, 400);
  mount();
  const selector = await screen.findByLabelText("Shared household time zone");
  const user = userEvent.setup();
  await user.selectOptions(selector, "Africa/Lusaka");
  await user.click(screen.getByRole("button", { name: "Save household calendar" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Select a supported named household time zone");
  expect(selector).toHaveValue("Africa/Lusaka");
  expect(calendar.configured).toBe(false);
});

it("invalidates calendar, occurrence and household reads after a successful explicit choice", async () => {
  const client = mocks.lifetime!.client;
  const keys = [["investments", "recurring", "occurrences", ids.plan], ["households"], ["household", ids.household]];
  keys.forEach(key => client.setQueryData(key, { fixture: true }));
  mount();
  const user = userEvent.setup();
  await user.selectOptions(await screen.findByLabelText("Shared household time zone"), "Africa/Lusaka");
  await user.click(screen.getByRole("button", { name: "Save household calendar" }));
  await waitFor(() => expect(calendar.configured).toBe(true));
  await waitFor(() => keys.forEach(key => expect(client.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated).toBe(true)));
});

it("refreshes on a household day-hint rollover without posting or choosing policy", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2030-01-20T21:59:00Z"));
  calendar = { timeZone: "Africa/Lusaka", configured: true, permittedActions: [] };
  mocks.role = "member";
  const occurrenceKey = ["investments", "recurring", "occurrences", ids.plan];
  mocks.lifetime!.client.setQueryData(occurrenceKey, listEnvelope([pendingOccurrence()]));
  expect(mocks.lifetime!.client.getQueryCache().find({ queryKey: occurrenceKey, exact: true })?.state.isInvalidated).toBe(false);
  mount();
  expect(await screen.findByText(/2030-01-20/)).toBeVisible();
  const reads = calls.filter(call => call.method === "GET").length;
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(await screen.findByText(/2030-01-21/)).toBeVisible();
  expect(calls.filter(call => call.method === "GET").length).toBeGreaterThan(reads);
  expect(mocks.lifetime!.client.getQueryCache().find({ queryKey: occurrenceKey, exact: true })?.state.isInvalidated).toBe(true);
  expect(calls.filter(call => call.method === "PUT")).toEqual([]);
});

it("strictly decodes configured versus unavailable calendar state without inventing a zone", () => {
  expect(readSipHouseholdCalendar({ success: true, data: calendar }).data.timeZone).toBeNull();
  expect(() => readSipHouseholdCalendar({ success: true, data: { timeZone: null, configured: true, permittedActions: [] } })).toThrow();
  expect(() => readSipHouseholdCalendar({ success: true, data: { timeZone: "Unsupported/Zone", configured: true, permittedActions: [] } })).toThrow();
});
