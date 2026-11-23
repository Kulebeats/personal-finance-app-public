import { webcrypto } from "node:crypto";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime } from "@/lib/operation-lifetime";
import { AddRecurringInvestmentForm } from "../AddRecurringInvestmentForm";

// The form, recurring command hooks, scoped QueryClient and operation lifetime are
// real. Transport, reference/settings reads, session and toast are test adapters.
// These caller regressions do not establish HTTP, DB or scheduler behavior.
const ids = {
  subject: "11111111-1111-4111-8111-111111111111", household: "22222222-2222-4222-8222-222222222222",
  account: "33333333-3333-4333-8333-333333333333", security: "44444444-4444-4444-8444-444444444444",
  plan: "55555555-5555-4555-8555-555555555555",
};
const mocks = vi.hoisted(() => ({
  api: vi.fn(), toast: vi.fn(),
  settings: { data: undefined as { timezone: string } | undefined, isLoading: false, isError: false },
  lifetime: null as { key: string; operation: OperationLifetime; client: QueryClient } | null,
}));
vi.mock("@/lib/queryClient", async original => ({ ...await original<typeof import("@/lib/queryClient")>(), apiRequest: mocks.api }));
vi.mock("@/hooks/useInvestments", async () => ({
  ...await import("@/hooks/investments/useRecurringInvestments"),
  useSecurities: () => ({ data: [{ id: ids.security, symbol: "SYNSTOCK", name: "Synthetic instrument",
    type: "stock", currency: "USD", currentPrice: "2.00" }], isLoading: false }),
}));
vi.mock("@/hooks/useAccounts", () => ({ useAccounts: () => ({ data: [{ id: ids.account, householdId: ids.household,
  name: "Synthetic custody", type: "investment", currency: "ZMW", isPrivate: false, ownerUserId: ids.subject }], isLoading: false }) }));
vi.mock("@/hooks/use-settings", () => ({ useDisplaySettings: () => mocks.settings }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: ids.subject }, household: { id: ids.household, role: "member" } },
  lifetime: mocks.lifetime, loading: false,
}) }));

interface Request {
  method: string; path: string; body: Record<string, unknown> | undefined; serializedBody: string | undefined;
}
let requests: Request[];
let write: (request: Request) => Promise<Response>;
const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }), {
  status: 200, headers: { "Content-Type": "application/json" },
});
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const dateInput = () => screen.getByLabelText("Initial date");
const posts = () => requests.filter(request => request.method === "POST");
function settings(timezone?: string, state: "ready" | "loading" | "error" = "ready") {
  mocks.settings = { data: timezone === undefined ? undefined : { timezone }, isLoading: state === "loading", isError: state === "error" };
}
function tree(content: ReactNode) {
  return <QueryClientProvider client={mocks.lifetime!.client}>{content}</QueryClientProvider>;
}
function mount(onSuccess = vi.fn()) {
  return render(tree(<AddRecurringInvestmentForm onSuccess={onSuccess} />));
}
function expectCreate(request: Request, date: string) {
  expect(request.path).toBe("/api/investments/recurring");
  expect(request.body).toEqual({ operationId: expect.stringMatching(uuid), type: "sip", frequency: "monthly",
    accountId: ids.account, securityId: ids.security, amount: "10.00", currency: "USD", nextExecutionDate: date });
}
async function fillOtherTerms(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox", { name: "Custody account" }));
  await user.click(screen.getByRole("option", { name: /Synthetic custody/ }));
  await user.click(screen.getByRole("combobox", { name: "Instrument" }));
  await user.click(screen.getByRole("option", { name: /SYNSTOCK/ }));
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "10.00" } });
}
async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Confirm Setup" }));
  await waitFor(() => expect(posts()).toHaveLength(1));
  return posts()[0];
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.api.mockReset();
  // Keep userEvent and React Query timers real; only the current instant is fixed.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-01-19T22:30:00.000Z"));
  vi.stubGlobal("crypto", webcrypto);
  settings("Africa/Lusaka"); requests = [];
  const operation = createOperationLifetime({ subject: ids.subject, household: ids.household });
  activateOperationLifetime(operation);
  const client = createDataQueryClient(undefined, operation);
  client.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { retry: false } });
  mocks.lifetime = { key: `${ids.subject}:${ids.household}`, operation, client };
  write = async request => json({ ...request.body, id: ids.plan, householdId: ids.household, isActive: true,
    authorizationRevision: 1, authorizationInitialExecutionDate: request.body?.nextExecutionDate,
    authorizationStatus: "authorization_recorded", permittedActions: ["authorize", "deactivate"] });
  mocks.api.mockImplementation((method: string, path: string, body?: Record<string, unknown>) => {
    const serializedBody = body === undefined ? undefined : JSON.stringify(body);
    const request = { method, path, serializedBody,
      body: serializedBody === undefined ? undefined : JSON.parse(serializedBody) as Record<string, unknown> };
    requests.push(request);
    if (method === "GET" && path === "/api/investments/recurring") return Promise.resolve(json([]));
    if (method === "POST" && path === "/api/investments/recurring") return write(request);
    throw new Error(`Unexpected date test transport: ${method} ${path}`);
  });
});
afterEach(() => {
  cleanup();
  if (mocks.lifetime) {
    retireOperationLifetime(mocks.lifetime.operation);
    retireDataClient(mocks.lifetime.client);
  }
  mocks.lifetime = null; vi.useRealTimers(); vi.unstubAllGlobals();
});

it.each([
  ["Africa/Lusaka", "2030-01-19T22:30:00.000Z", "2030-01-21"], // 00:30 on January 20.
  ["America/Los_Angeles", "2030-01-20T00:30:00.000Z", "2030-01-20"], // 16:30 on January 19.
  ["America/Los_Angeles", "2030-03-10T07:30:00.000Z", "2030-03-10"], // 23:30 before the spring DST change.
  ["Africa/Lusaka", "2030-12-31T22:30:00.000Z", "2031-01-02"],
  ["Africa/Lusaka", "2032-02-28T22:30:00.000Z", "2032-03-01"],
])("defaults and submits the next saved-zone calendar date in %s at %s", async (zone, instant, expected) => {
  vi.setSystemTime(new Date(instant)); settings(zone);
  const onSuccess = vi.fn(), user = userEvent.setup(); mount(onSuccess);
  expect(dateInput()).toHaveValue(expected);
  await fillOtherTerms(user);
  expectCreate(await submit(user), expected);
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
});

it("waits for valid saved settings, seeds at that instant, and does not reseed on later settings changes", async () => {
  settings("Africa/Lusaka", "loading");
  const onSuccess = vi.fn(), user = userEvent.setup(), view = mount(onSuccess);
  expect(dateInput()).toHaveValue("");
  vi.setSystemTime(new Date("2030-01-20T22:30:00.000Z"));
  settings("Africa/Lusaka");
  view.rerender(tree(<AddRecurringInvestmentForm onSuccess={onSuccess} />));
  expect(dateInput()).toHaveValue("2030-01-22");
  vi.setSystemTime(new Date("2030-01-23T00:30:00.000Z")); settings("America/Los_Angeles");
  view.rerender(tree(<AddRecurringInvestmentForm onSuccess={onSuccess} />));
  expect(dateInput()).toHaveValue("2030-01-22");
  await fillOtherTerms(user);
  expectCreate(await submit(user), "2030-01-22");
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
});

it.each([
  { zone: undefined, state: "ready" as const },
  { zone: undefined, state: "loading" as const },
  { zone: "Africa/Lusaka", state: "error" as const },
  { zone: "Not/A_Zone", state: "ready" as const },
])("leaves unavailable/invalid settings blank and accepts an explicit date ($state, $zone)", async ({ zone, state }) => {
  settings(zone, state);
  const onSuccess = vi.fn(), user = userEvent.setup(); mount(onSuccess);
  expect(dateInput()).toHaveValue("");
  await fillOtherTerms(user);
  fireEvent.change(dateInput(), { target: { value: "2031-04-07" } });
  expectCreate(await submit(user), "2031-04-07");
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
});

it.each(["chosen", "cleared", "same blank"] as const)("preserves a user's %s date input when saved settings first arrive", async edit => {
  settings(undefined, "loading");
  const onSuccess = vi.fn(), user = userEvent.setup(), view = mount(onSuccess);
  expect(dateInput()).toHaveValue("");
  if (edit !== "same blank") fireEvent.change(dateInput(), { target: { value: "2031-04-07" } });
  if (edit === "cleared") fireEvent.change(dateInput(), { target: { value: "" } });
  // A native input event also represents an explicit choice when its value is
  // unchanged; React Hook Form's dirty-value comparison cannot record that intent.
  if (edit === "same blank") fireEvent.input(dateInput(), { target: { value: "" } });
  settings("Africa/Lusaka");
  view.rerender(tree(<AddRecurringInvestmentForm onSuccess={onSuccess} />));
  expect(dateInput()).toHaveValue(edit === "chosen" ? "2031-04-07" : "");
  await fillOtherTerms(user);
  if (edit === "chosen") {
    expectCreate(await submit(user), "2031-04-07");
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  } else {
    await user.click(screen.getByRole("button", { name: "Confirm Setup" }));
    expect(await screen.findByText("Enter a valid initial date")).toBeVisible();
    expect(posts()).toEqual([]);
  }
});

it("preserves a seeded date's explicit clear through a settings refresh", () => {
  const onSuccess = vi.fn(), view = mount(onSuccess);
  fireEvent.change(dateInput(), { target: { value: "" } });
  vi.setSystemTime(new Date("2030-01-23T00:30:00.000Z")); settings("America/Los_Angeles");
  view.rerender(tree(<AddRecurringInvestmentForm onSuccess={onSuccess} />));
  expect(dateInput()).toHaveValue("");
  expect(posts()).toEqual([]);
});

it("keeps an uncertain create's exact UUID and serialized date through midnight, settings changes and remount", async () => {
  const acknowledge = write;
  write = async () => { throw new TypeError("Synthetic acknowledgement lost after server acceptance"); };
  const onSuccess = vi.fn(), user = userEvent.setup(), view = mount(onSuccess);
  await fillOtherTerms(user);
  fireEvent.change(dateInput(), { target: { value: "2030-01-21" } });
  const original = await submit(user);
  expectCreate(original, "2030-01-21");
  await screen.findByRole("button", { name: "Retry same plan" });
  expect(onSuccess).not.toHaveBeenCalled();

  vi.setSystemTime(new Date("2030-01-22T01:30:00.000Z")); settings("America/Los_Angeles");
  view.rerender(tree(<AddRecurringInvestmentForm onSuccess={onSuccess} />));
  expect(dateInput()).toHaveValue("2030-01-21");
  expect(dateInput()).toBeDisabled();
  view.unmount(); mount(onSuccess);
  expect(dateInput()).toHaveValue("2030-01-21");
  expect(dateInput()).toBeDisabled();
  expect(posts()).toHaveLength(1);

  write = acknowledge;
  await user.click(screen.getByRole("button", { name: "Retry same plan" }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  expect(posts()).toHaveLength(2);
  expect(posts()[1].body).toEqual(original.body);
  expect(posts()[1].body?.operationId).toBe(original.body?.operationId);
  expect(posts()[1].serializedBody).toBe(original.serializedBody);
});
