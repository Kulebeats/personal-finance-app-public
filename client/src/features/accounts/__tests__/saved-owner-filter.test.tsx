import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAccountsData } from "../hooks/useAccountsData";
import { personalEnvelope, personalPreferences, personalUserId } from "@/hooks/__tests__/personal-preferences-fixture";

const mocks = vi.hoisted(() => ({ api: vi.fn(), fetch: vi.fn(), history: vi.fn(), allRefetch: vi.fn(), allError: null as Error | null, sessionLoading: false, allAccounts: [{ id: "mine", type: "checking", name: "My account", balance: "100", currency: "ZMW", ownerUserId: "11111111-1111-4111-8111-111111111111" }] }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), apiCall: mocks.api }));
vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: mocks.fetch }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ status: mocks.sessionLoading ? null : { state: "ready", subject: { id: "11111111-1111-4111-8111-111111111111" } }, loading: mocks.sessionLoading }) }));
vi.mock("@/hooks", async original => ({ ...await original<typeof import("@/hooks")>(),
  useNetWorthHistory: mocks.history, useExportAccountsSummary: () => ({ mutate: vi.fn() }),
}));
let client: QueryClient;
function mount(cached = true) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (cached) client.setQueryData(["userPreferences"], personalPreferences());
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(useAccountsData, { wrapper });
}
beforeEach(() => {
  mocks.api.mockReset(); mocks.fetch.mockReset(); mocks.history.mockReset(); mocks.allRefetch.mockReset(); mocks.allError = null; mocks.sessionLoading = false;
  mocks.allAccounts = [{ id: "mine", type: "checking", name: "My account", balance: "100", currency: "ZMW", ownerUserId: personalUserId }];
  mocks.history.mockImplementation((_range: string, _scope: string, enabled = true) => ({
    data: enabled && !mocks.allError ? { accounts: mocks.allAccounts, series: [], latest: null, currentStatus: "unavailable" } : undefined,
    isLoading: false, error: enabled ? mocks.allError : null, refetch: mocks.allRefetch,
  }));
});
afterEach(() => { cleanup(); client?.clear(); });

it("restores Mine before enabling the coherent account frame", async () => {
  let resolve!: (value: Response) => void;
  mocks.fetch.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const { result } = mount(false);
  expect(result.current.ownerUserId).toBe("all");
  expect(mocks.history.mock.calls.every(([, , enabled]) => enabled === false)).toBe(true);
  await act(async () => { resolve(new Response(JSON.stringify(personalEnvelope({ defaultAccountFilter: "mine" })))); });
  await waitFor(() => expect(result.current.ownerUserId).toBe(personalUserId));
  expect(mocks.history.mock.calls.some(([range, scope, enabled, includeAccounts, owner]) =>
    range === "1m" && scope === "user" && enabled && includeAccounts && owner === personalUserId)).toBe(true);
  expect(result.current.accounts).toEqual(mocks.allAccounts);
  expect(mocks.api).not.toHaveBeenCalled();
});

it("defaults to All and includes the current user's first personal account without persisting fallback defaults", () => {
  const { result } = mount();
  expect(result.current.ownerUserId).toBe("all");
  expect(result.current.accounts).toEqual(mocks.allAccounts);
  expect(mocks.api).not.toHaveBeenCalled();
});

it("retains a failed Shared choice, retries its enum, resets to All, and keeps another member's choice temporary", async () => {
  mocks.api.mockRejectedValueOnce(new Error("Filter offline")).mockResolvedValueOnce(personalEnvelope({ defaultAccountFilter: "shared" })).mockResolvedValueOnce(personalEnvelope());
  const { result } = mount();
  act(() => { result.current.setOwnerUserId(null); });
  await waitFor(() => expect(result.current.filterSaveError).toBe("Filter offline"));
  expect(result.current.ownerUserId).toBeNull();
  await act(async () => { await result.current.retryOwnerFilter(); });
  expect(JSON.parse(mocks.api.mock.calls[1][1].body)).toEqual({ defaultAccountFilter: "shared" });
  act(() => { result.current.resetOwnerFilter(); });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3));
  expect(JSON.parse(mocks.api.mock.calls[2][1].body)).toEqual({ defaultAccountFilter: "all" });
  const foreign = "22222222-2222-4222-8222-222222222222";
  act(() => { result.current.setOwnerUserId(foreign); });
  expect(result.current.ownerUserId).toBe(foreign);
  expect(result.current.temporaryOwnerFilter).toBe(true);
  expect(mocks.api).toHaveBeenCalledTimes(3);
});

it("keeps a newer filter when the older queued save is acknowledged", async () => {
  let resolve!: (value: unknown) => void;
  mocks.api.mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce(personalEnvelope({ defaultAccountFilter: "mine" }));
  const { result } = mount();
  act(() => { result.current.setOwnerUserId(null); });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  act(() => { result.current.setOwnerUserId(personalUserId); });
  expect(mocks.api).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(personalEnvelope({ defaultAccountFilter: "shared" })); });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  expect(result.current.ownerUserId).toBe(personalUserId);
  expect(JSON.parse(mocks.api.mock.calls[1][1].body)).toEqual({ defaultAccountFilter: "mine" });
});

it("keeps an unknown saved filter unavailable on GET failure and retries without a write", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("Saved filter offline")).mockResolvedValueOnce(new Response(JSON.stringify(personalEnvelope())));
  const { result } = mount(false);
  await waitFor(() => expect(result.current.ownerPreferencesError?.message).toBe("Saved filter offline"));
  expect(mocks.history.mock.calls.every(([, , enabled]) => enabled === false)).toBe(true);
  await act(async () => { await result.current.retryOwnerPreferences(); });
  await waitFor(() => expect(result.current.accounts).toEqual(mocks.allAccounts));
  expect(mocks.api).not.toHaveBeenCalled();
});

it("uses the authorized frame inventory to distinguish filtered-empty from no accessible accounts", async () => {
  const { result } = mount();
  mocks.api.mockResolvedValueOnce(personalEnvelope({ defaultAccountFilter: "shared" }));
  act(() => { result.current.setOwnerUserId(null); });
  await waitFor(() => expect(result.current.hasAccessibleAccounts).toBe(true));
  expect(result.current.isFiltered).toBe(true);
  expect(result.current.accounts).toEqual([]);
});

it("gates restored Mine while the current session identity is still loading", () => {
  mocks.sessionLoading = true;
  const { result, rerender } = mount();
  act(() => { client.setQueryData(["userPreferences"], personalPreferences({ defaultAccountFilter: "mine" })); });
  expect(mocks.history.mock.calls.every(([, , enabled]) => enabled === false)).toBe(true);
  expect(result.current.ownerPreferencesLoading).toBe(true);
  mocks.sessionLoading = false; rerender();
  expect(result.current.ownerUserId).toBe(personalUserId);
  expect(result.current.ownerPreferencesReady).toBe(true);
});

it("surfaces a frame inventory failure with a retry instead of claiming zero accessible accounts", async () => {
  const { result } = mount();
  mocks.allError = new Error("Accessible account count offline");
  act(() => { client.setQueryData(["userPreferences"], personalPreferences({ defaultAccountFilter: "shared" })); });
  await waitFor(() => expect(result.current.accountsError?.message).toBe("Accessible account count offline"));
  expect(result.current.hasAccessibleAccounts).toBeUndefined();
  act(() => { result.current.refetch(); });
  expect(mocks.allRefetch).toHaveBeenCalledTimes(1);
});

it("recognizes no accessible accounts only from the ready visible frame", async () => {
  mocks.allAccounts = [];
  const { result } = mount();
  act(() => { client.setQueryData(["userPreferences"], personalPreferences({ defaultAccountFilter: "shared" })); });
  await waitFor(() => expect(result.current.hasAccessibleAccounts).toBe(false));
  expect(result.current.accountsError).toBeNull();
});
