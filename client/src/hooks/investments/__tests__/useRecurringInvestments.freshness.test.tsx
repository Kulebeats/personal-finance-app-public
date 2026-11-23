import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, focusManager, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRecurringInvestments } from "../useRecurringInvestments";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import {
  activateOperationLifetime, createOperationLifetime, retireOperationLifetime, type OperationLifetime,
} from "@/lib/operation-lifetime";

// Real recurring query, response decoder, scoped QueryClient and lifetime. Only
// signed transport/session adapters are controlled; this is client evidence.
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  lifetime: null as { key: string; client: QueryClient; operation: OperationLifetime } | null,
}));
vi.mock("@/lib/queryClient", async original => ({
  ...await original<typeof import("@/lib/queryClient")>(), apiRequest: mocks.api,
}));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({
  status: { state: "ready", subject: { id: mocks.lifetime?.operation.expectations?.subject },
    household: { id: mocks.lifetime?.operation.expectations?.household, role: "member" } },
  lifetime: mocks.lifetime,
}) }));
const household = "22222222-2222-4222-8222-222222222222";
const initialPlan = {
  id: "55555555-5555-4555-8555-555555555555", householdId: household,
  accountId: "33333333-3333-4333-8333-333333333333", securityId: "44444444-4444-4444-8444-444444444444",
  type: "sip", amount: "10.00", currency: "USD", frequency: "monthly",
  nextExecutionDate: "2031-01-20", isActive: true, authorizationRevision: 1,
  authorizationInitialExecutionDate: "2031-01-20", authorizationStatus: "authorization_recorded",
  permittedActions: ["authorize", "deactivate"], createdAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z",
};
const peerUpdatedPlan = {
  ...initialPlan, isActive: false, authorizationStatus: "inactive", permittedActions: ["authorize"],
};
let current: typeof initialPlan;
let clients: QueryClient[];
let requests: Array<{ method: string; operation: OperationLifetime }>;
const response = (plan = current) => new Response(JSON.stringify({ success: true, data: [plan] }), {
  status: 200, headers: { "Content-Type": "application/json" },
});
function scope() {
  const operation = createOperationLifetime({ subject: "11111111-1111-4111-8111-111111111111", household });
  activateOperationLifetime(operation);
  const client = createDataQueryClient(undefined, operation);
  clients.push(client);
  mocks.lifetime = { key: String(operation.id), client, operation };
}
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={mocks.lifetime!.client}>{children}</QueryClientProvider>;
}
function Plans() {
  const query = useRecurringInvestments();
  return <output data-testid="plan-status">{query.data?.[0]?.authorizationStatus ?? query.status}</output>;
}
beforeEach(() => {
  // Query notifications and MutationObserver use real time. Rendering the real
  // query result gives waitFor DOM changes to observe; its interval is fake.
  // Nothing sends a mutation or explicitly invalidates the query.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
  mocks.api.mockReset(); current = initialPlan; clients = []; requests = [];
  focusManager.setFocused(true);
  scope();
  mocks.api.mockImplementation((method: string, path: string, body: unknown, operation: OperationLifetime) => {
    if (method !== "GET" || path !== "/api/investments/recurring" || body !== undefined) {
      throw new Error("Unexpected client transport");
    }
    requests.push({ method, operation });
    return Promise.resolve(response());
  });
});
afterEach(() => {
  cleanup();
  retireOperationLifetime(mocks.lifetime?.operation);
  clients.forEach(retireDataClient);
  mocks.lifetime = null;
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

it("shows another member's changed plan within one minute while the list stays mounted", async () => {
  render(<Plans />, { wrapper });
  await waitFor(() => expect(screen.getByTestId("plan-status")).toHaveTextContent("authorization_recorded"));
  expect(requests).toHaveLength(1);
  current = peerUpdatedPlan;
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  await waitFor(() => expect(screen.getByTestId("plan-status")).toHaveTextContent("inactive"));
  expect(requests).toHaveLength(2);
  expect(requests.every(request => request.operation === mocks.lifetime!.operation)).toBe(true);
});

it("refreshes the real cached list when the tab returns to focus", async () => {
  render(<Plans />, { wrapper });
  await waitFor(() => expect(screen.getByTestId("plan-status")).toHaveTextContent("authorization_recorded"));
  act(() => focusManager.setFocused(false));
  current = peerUpdatedPlan;
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(requests).toHaveLength(1); // No polling interval has elapsed.
  await act(async () => focusManager.setFocused(true));
  await waitFor(() => expect(screen.getByTestId("plan-status")).toHaveTextContent("inactive"));
  expect(requests).toHaveLength(2);
  act(() => focusManager.setFocused(false));
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(requests).toHaveLength(2); // Hidden tabs do not keep polling.
});

it("stops polling an unmounted list and refreshes its expired cache when reopened", async () => {
  const first = render(<Plans />, { wrapper });
  await waitFor(() => expect(screen.getByTestId("plan-status")).toHaveTextContent("authorization_recorded"));
  first.unmount();
  current = peerUpdatedPlan;
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(requests).toHaveLength(1);
  render(<Plans />, { wrapper });
  await waitFor(() => expect(screen.getByTestId("plan-status")).toHaveTextContent("inactive"));
  expect(requests).toHaveLength(2);
});

it("cannot publish a held refresh from a retired lifetime into a replacement client", async () => {
  const first = render(<Plans />, { wrapper });
  await waitFor(() => expect(screen.getByTestId("plan-status")).toHaveTextContent("authorization_recorded"));
  const old = mocks.lifetime!;
  let release!: (value: Response) => void;
  mocks.api.mockImplementationOnce((method: string, _path: string, _body: unknown, operation: OperationLifetime) => {
    requests.push({ method, operation });
    return new Promise<Response>(resolve => { release = resolve; });
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  // This witness must reach the periodic transport before retirement.
  expect(requests).toHaveLength(2);
  first.unmount(); retireOperationLifetime(old.operation); retireDataClient(old.client);
  scope(); current = peerUpdatedPlan;
  render(<Plans />, { wrapper });
  await waitFor(() => expect(screen.getByTestId("plan-status")).toHaveTextContent("inactive"));
  await act(async () => { release(response(initialPlan)); });
  expect(screen.getByTestId("plan-status")).toHaveTextContent("inactive");
  expect(old.client.getQueryCache().getAll()).toEqual([]);
  expect(requests[1].operation).toBe(old.operation);
  expect(requests[2].operation).toBe(mocks.lifetime!.operation);
});
