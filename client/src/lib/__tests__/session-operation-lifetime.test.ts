import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiCall, registerStepUpHandler } from "@/lib/api";
import { apiRequest, createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import { clearCsrfToken } from "@/lib/csrf";
import { activateOperationLifetime, captureOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const replace = () => { retireOperationLifetime(); activateOperationLifetime(createOperationLifetime()); };

describe("protected operations retain their originating data lifetime", () => {
  beforeEach(() => { clearCsrfToken(); activateOperationLifetime(createOperationLifetime()); });
  afterEach(() => { retireOperationLifetime(); registerStepUpHandler(null); vi.unstubAllGlobals(); });

  it.each(["apiCall", "apiRequest"])("%s refuses a mutation after delayed CSRF changes identity", async transport => {
    const csrf = deferred<Response>();
    const fetcher = vi.fn(() => csrf.promise);
    vi.stubGlobal("fetch", fetcher);
    const result = transport === "apiCall" ? apiCall("/accounts", { method: "POST" }) : apiRequest("POST", "/api/accounts");
    const rejected = expect(result).rejects.toThrow(/session changed/i);
    replace();
    csrf.resolve(response({ csrfToken: "old" }));
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("CSRF_INVALID retry retains the old lifetime through renewed token acquisition", async () => {
    const renewal = deferred<Response>();
    let tokens = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/csrf-token") return ++tokens === 1 ? response({ csrfToken: "first" }) : renewal.promise;
      return response({ error: { code: "CSRF_INVALID", message: "stale" } }, 403);
    });
    vi.stubGlobal("fetch", fetcher);
    const result = apiCall("/accounts", { method: "POST" });
    const rejected = expect(result).rejects.toThrow(/session changed/i);
    await vi.waitFor(() => expect(tokens).toBe(2));
    replace(); renewal.resolve(response({ csrfToken: "replacement" }));
    await rejected;
    expect(fetcher.mock.calls.filter(([url]) => String(url) === "/api/accounts")).toHaveLength(1);
  });

  it("a stale step-up completion cannot replay an operation", async () => {
    const step = deferred<boolean>();
    registerStepUpHandler(() => step.promise);
    const fetcher = vi.fn(async () => response({ error: { code: "STEP_UP_REQUIRED", message: "Verify" } }, 401));
    vi.stubGlobal("fetch", fetcher);
    const result = apiCall("/accounts");
    const rejected = expect(result).rejects.toThrow(/session changed/i);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    replace(); step.resolve(true); await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps current-lifetime step-up retry working", async () => {
    registerStepUpHandler(async () => true);
    const fetcher = vi.fn().mockResolvedValueOnce(response({ error: { code: "STEP_UP_REQUIRED" } }, 401)).mockResolvedValueOnce(response({ success: true }));
    vi.stubGlobal("fetch", fetcher);
    await expect(apiCall("/accounts")).resolves.toEqual({ success: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("preserves structural error code and message through apiRequest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ error: { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify first" } }, 403)));
    await expect(apiRequest("GET", "/api/accounts")).rejects.toMatchObject({ status: 403, code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify first" });
  });

  it("late callbacks and warm caches remain on their original client", async () => {
    const old = createDataQueryClient(undefined, captureOperationLifetime());
    old.setQueryData(["profile"], { id: "a" });
    const result = deferred<{ id: string }>();
    let started = false;
    const mutation = old.getMutationCache().build(old, { mutationFn: () => { started = true; return result.promise; }, onSuccess: value => { old.setQueryData(["profile"], value); } });
    const pending = mutation.execute(undefined);
    await vi.waitFor(() => expect(started).toBe(true));
    retireDataClient(old); replace();
    const next = createDataQueryClient(undefined, captureOperationLifetime());
    next.setQueryData(["profile"], { id: "b" });
    result.resolve({ id: "late-a" }); await pending;
    expect(next.getQueryData(["profile"])).toEqual({ id: "b" });
    next.clear(); old.clear();
  });

  it("does not start an old mutation after its optimistic onMutate awaited", async () => {
    const client = createDataQueryClient(undefined, captureOperationLifetime());
    const preparation = deferred<void>();
    const fetcher = vi.fn(async () => response({ success: true }));
    vi.stubGlobal("fetch", fetcher);
    const mutation = client.getMutationCache().build(client, { onMutate: () => preparation.promise, mutationFn: () => apiCall("/accounts") });
    const pending = mutation.execute(undefined);
    const rejected = expect(pending).rejects.toThrow(/session changed/i);
    replace(); preparation.resolve(); await rejected;
    expect(fetcher).not.toHaveBeenCalled();
    client.clear();
  });
});
