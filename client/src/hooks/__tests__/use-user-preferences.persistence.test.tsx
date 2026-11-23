import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useUserPreferences, useUpdateUserPreferences } from "../use-settings";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { personalEnvelope, personalPreferences, personalUserId } from "./personal-preferences-fixture";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), api: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiCall: mocks.api, securityApi: {} }));
vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: mocks.fetch }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
let client: QueryClient;
function setup(saved = false) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (saved) client.setQueryData(["userPreferences"], personalPreferences());
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { wrapper };
}
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); client?.clear(); retireOperationLifetime(); });

it("loads personal preferences from the distinct own-user endpoint with nullable timestamps", async () => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify(personalEnvelope())));
  const { result } = renderHook(useUserPreferences, setup());
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(mocks.fetch).toHaveBeenCalledWith("/api/settings/user-preferences", expect.any(Object), null);
  expect(result.current.data).toEqual(personalPreferences());
});

it.each([null, {}, { ...personalPreferences(), defaultAccountFilter: "foreign-owner" }])("rejects malformed successful GET preferences %j", async preferences => {
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, data: { preferences } })));
  const { result } = renderHook(useUserPreferences, setup());
  await waitFor(() => expect(result.current.isFetching).toBe(false));
  expect(result.current.isError).toBe(true);
  expect(result.current.data).toBeUndefined();
});

it("rejects a malformed or unacknowledged save before cache and success toast, then permits retry", async () => {
  mocks.api.mockResolvedValueOnce({ success: true, data: {} }).mockResolvedValueOnce(personalEnvelope()).mockResolvedValueOnce(personalEnvelope({ autoFillTodayDate: false }));
  const { result } = renderHook(useUpdateUserPreferences, setup(true));
  await act(async () => { await expect(result.current.mutateAsync({ autoFillTodayDate: false })).rejects.toThrow(/invalid personal preferences/i); });
  expect(client.getQueryData(["userPreferences"])).toEqual(personalPreferences());
  expect(mocks.success).not.toHaveBeenCalled();
  await act(async () => { await expect(result.current.mutateAsync({ autoFillTodayDate: false })).rejects.toThrow(/not acknowledged/i); });
  await act(async () => { await result.current.mutateAsync({ autoFillTodayDate: false }); });
  expect(mocks.api).toHaveBeenLastCalledWith("/settings/user-preferences", expect.objectContaining({ method: "PUT", body: '{"autoFillTodayDate":false}' }), true, false, null);
  expect(mocks.success).toHaveBeenCalledTimes(1);
});

it("serializes disjoint personal edits across two hook instances before applying their full acknowledgements", async () => {
  let resolve!: (value: unknown) => void;
  mocks.api.mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce(personalEnvelope({ rememberLastAccount: false, defaultAccountFilter: "shared" }));
  const wrapper = setup(true);
  const one = renderHook(useUpdateUserPreferences, wrapper); const two = renderHook(useUpdateUserPreferences, wrapper);
  let first!: Promise<unknown>; let second!: Promise<unknown>;
  act(() => { first = one.result.current.mutateAsync({ rememberLastAccount: false }); });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  await act(async () => { second = two.result.current.mutateAsync({ defaultAccountFilter: "shared" }); });
  expect(mocks.api).toHaveBeenCalledTimes(1);
  await act(async () => { resolve(personalEnvelope({ rememberLastAccount: false })); await first; await second; });
  expect(client.getQueryData(["userPreferences"])).toEqual(personalPreferences({ rememberLastAccount: false, defaultAccountFilter: "shared" }));
});

it("fences queued and pending saves when their originating identity retires", async () => {
  const operation = createOperationLifetime({ subject: personalUserId }); activateOperationLifetime(operation);
  let resolve!: (value: unknown) => void;
  mocks.api.mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const { result } = renderHook(useUpdateUserPreferences, setup(true));
  let first!: Promise<unknown>;
  act(() => { first = result.current.mutateAsync({ rememberLastAccount: false }); });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  retireOperationLifetime(operation); activateOperationLifetime(createOperationLifetime());
  await act(async () => { resolve(personalEnvelope({ rememberLastAccount: false })); await expect(first).rejects.toThrow(/session changed/i); });
  await act(async () => { await expect(result.current.mutateAsync({ skipDuplicateImports: false })).rejects.toThrow(/session changed/i); });
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(["userPreferences"])).toEqual(personalPreferences());
  expect(mocks.success).not.toHaveBeenCalled(); expect(mocks.error).not.toHaveBeenCalled();
});
