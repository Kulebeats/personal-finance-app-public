import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import PreferencesSection from "..";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("rejects a null personal response without reading or creating household policy", async () => {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    let data: unknown;
    if (url === "/api/settings/user-preferences") data = { preferences: null };
    else if (url === "/api/ai/consent") data = { consentGiven: false, needsReconsent: false };
    else throw new Error(`Unexpected request in missing policy control: ${url}`);
    return { ok: true, headers: { get: () => "application/json" }, json: async () => ({ success: true, data }) } as unknown as Response;
  }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  render(<PreferencesSection />, { wrapper: Wrapper });
  expect(await screen.findByRole("alert")).toHaveTextContent(/invalid personal preferences/i);
  expect(screen.queryByText("Transaction Entry")).not.toBeInTheDocument();
  expect(queryClient.getQueryData(["userPreferences"])).toBeUndefined();
  expect(calls).toEqual(expect.arrayContaining([
    { url: "/api/settings/user-preferences", method: "GET" },
    { url: "/api/ai/consent", method: "GET" },
  ]));
  expect(calls.every(({ method }) => method === "GET")).toBe(true);
  expect(calls.some(({ url }) => url === "/api/settings/preferences")).toBe(false);
  queryClient.clear();
});
