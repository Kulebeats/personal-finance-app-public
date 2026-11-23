import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useExportTransactions, useExportBalanceHistory, useExportAccountsSummary } from "../useAccounts";
import { accountsApi } from "@/lib/api";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const cases = [
  { name: "transactions", filename: "transactions.csv", hook: () => { const mutation = useExportTransactions(); return () => mutation.mutateAsync({ id: "one" }); } },
  { name: "history", filename: "balance-history.csv", hook: () => { const mutation = useExportBalanceHistory(); return () => mutation.mutateAsync("one"); } },
  { name: "summary", filename: "accounts-summary.csv", hook: () => { const mutation = useExportAccountsSummary(); return () => mutation.mutateAsync(); } },
];

describe("actual account export hooks", () => {
  const created = vi.fn(); const click = vi.fn();
  beforeEach(() => {
    mocks.toast.mockReset(); created.mockReset().mockReturnValue("blob:account"); click.mockReset();
    activateOperationLifetime(createOperationLifetime({ subject: "a", household: "one" }));
    vi.stubGlobal("URL", class extends URL { static createObjectURL = created; static revokeObjectURL = vi.fn(); });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { click(this.download); });
  });
  afterEach(() => { cleanup(); retireOperationLifetime(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it.each(cases)("never downloads $name when deferred Blob conversion outlives its origin", async testCase => {
    const body = deferred<Blob>(); const response = new Response(); vi.spyOn(response, "blob").mockReturnValue(body.promise);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const operation = createOperationLifetime({ subject: "a", household: "one" }); activateOperationLifetime(operation);
    const client = createDataQueryClient(undefined, operation);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = renderHook(testCase.hook, { wrapper });
    let pending!: Promise<Blob>;
    act(() => { pending = view.result.current(); });
    const rejected = expect(pending).rejects.toThrow(/session changed/i);
    await waitFor(() => expect(response.blob).toHaveBeenCalled());
    retireDataClient(client); retireOperationLifetime(); activateOperationLifetime(createOperationLifetime({ subject: "b", household: "two" })); view.unmount();
    body.resolve(new Blob(["private A CSV"])); await rejected;
    expect(created).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled(); expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("checks the hook continuation if identity changes after the API Blob assertion", async () => {
    const body = deferred<Blob>(); const response = new Response(); vi.spyOn(response, "blob").mockReturnValue(body.promise);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const operation = createOperationLifetime({ subject: "a", household: "one" }); activateOperationLifetime(operation);
    const client = createDataQueryClient(undefined, operation);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = renderHook(cases[2].hook, { wrapper }); let pending!: Promise<Blob>;
    act(() => { pending = view.result.current(); }); const rejected = expect(pending).rejects.toThrow(/session changed/i);
    await waitFor(() => expect(response.blob).toHaveBeenCalled());
    await act(async () => { body.resolve(new Blob(["private"])); await Promise.resolve(); retireDataClient(client); retireOperationLifetime(); activateOperationLifetime(createOperationLifetime({ subject: "b" })); await rejected; });
    expect(created).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
  });

  it.each(cases)("preserves $name current-lifetime filename and Blob result", async testCase => {
    const blob = new Blob(["csv"]); const response = new Response(); vi.spyOn(response, "blob").mockResolvedValue(blob);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const operation = createOperationLifetime({ subject: "a", household: "one" }); activateOperationLifetime(operation);
    const client = createDataQueryClient(undefined, operation);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = renderHook(testCase.hook, { wrapper });
    await act(async () => { expect(await view.result.current()).toBe(blob); });
    expect(click).toHaveBeenCalledWith(testCase.filename); client.clear();
  });

  it("keeps account export forbidden errors structural", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Export denied" } }), { status: 403 })));
    await expect(accountsApi.exportSummary()).rejects.toMatchObject({ status: 403, code: "FORBIDDEN", message: "Export denied" });
  });
});
