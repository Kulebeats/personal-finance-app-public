import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadProtectedResource, isProtectedMediaSource, useProtectedObjectUrl } from "../protected-media";
import { ProtectedImage } from "@/components/session/ProtectedImage";
import { activateOperationLifetime, captureOperationLifetime, createOperationLifetime, retireOperationLifetime } from "../operation-lifetime";
import { subscribeSessionInvalidation } from "../session";
import { createDataQueryClient, retireDataClient } from "../queryClient";
import { protectedFetch } from "../protected-fetch";

function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }

describe("protected binary transport", () => {
  const created = vi.fn(); const revoked = vi.fn();
  beforeEach(() => {
    activateOperationLifetime(createOperationLifetime({ subject: "a", household: "one" }));
    created.mockReset().mockReturnValue("blob:protected"); revoked.mockReset();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = created; static revokeObjectURL = revoked; });
  });
  afterEach(() => { cleanup(); retireOperationLifetime(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("uses originating expectation headers for images and revokes its URL on unmount", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new Blob(["image"], { type: "image/png" })));
    vi.stubGlobal("fetch", fetcher);
    const view = renderHook(() => useProtectedObjectUrl("/api/receipts/one/thumbnail"));
    await waitFor(() => expect(view.result.current.url).toBe("blob:protected"));
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get("X-Capital-Subject")).toBe("a");
    expect(headers.get("X-Capital-Household")).toBe("one");
    view.unmount(); expect(revoked).toHaveBeenCalledWith("blob:protected");
  });

  it("does not create a blob URL for an old response body after identity replacement", async () => {
    const body = deferred<Blob>(); const response = new Response();
    vi.spyOn(response, "blob").mockReturnValue(body.promise);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    renderHook(() => useProtectedObjectUrl("/api/receipts/one/thumbnail"));
    await waitFor(() => expect(response.blob).toHaveBeenCalled());
    retireOperationLifetime(); activateOperationLifetime(createOperationLifetime({ subject: "b", household: "two" }));
    await act(async () => { body.resolve(new Blob(["old private image"])); });
    expect(created).not.toHaveBeenCalled();
  });

  it("preserves the server filename and performs a single guarded blob download", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("csv", { headers: { "Content-Disposition": 'attachment; filename="report.csv"' } }));
    vi.stubGlobal("fetch", fetcher);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe("blob:protected"); expect(this.download).toBe("report.csv");
    });
    await downloadProtectedResource("/api/reports/exports/one?download=true");
    expect(fetcher).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); expect(revoked).toHaveBeenCalledWith("blob:protected");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("X-Capital-Subject")).toBe("a");
  });

  it("never downloads after an in-flight blob conversion outlives its operation", async () => {
    const body = deferred<Blob>(); const response = new Response();
    vi.spyOn(response, "blob").mockReturnValue(body.promise);
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const pending = downloadProtectedResource("/api/reports/exports/one?download=true", "report.csv");
    const rejected = expect(pending).rejects.toThrow(/session changed/i);
    await waitFor(() => expect(response.blob).toHaveBeenCalled());
    retireOperationLifetime(); activateOperationLifetime(createOperationLifetime({ subject: "b" }));
    body.resolve(new Blob(["private csv"])); await rejected;
    expect(created).not.toHaveBeenCalled();
  });

  it.each(["/uploads/profile.jpg", "/api/receipts/one/thumbnail"])("classifies same-origin %s as protected media", source => expect(isProtectedMediaSource(source)).toBe(true));

  it.each(["https://external.example/uploads/avatar.jpg", "data:image/png;base64,aW1n", "blob:preview", "/assets/logo.png"])("leaves external/static/local preview %s on native transport without credentials or auth headers", source => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<ProtectedImage src={source} alt="Public picture" />);
    expect(screen.getByRole("img", { name: "Public picture" })).toHaveAttribute("src", source);
    expect(fetcher).not.toHaveBeenCalled();
    expect(isProtectedMediaSource(source)).toBe(false);
  });

  it("defers lazy protected images until intersection while preserving image props and refs", async () => {
    let reveal!: () => void;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { reveal = () => callback([{ isIntersecting: true }]); }
      observe = vi.fn(); disconnect = vi.fn();
    });
    const fetcher = vi.fn(async () => new Response("image")); vi.stubGlobal("fetch", fetcher);
    const assigned = vi.fn();
    render(<ProtectedImage ref={assigned} src="/uploads/avatar.png" alt="Avatar" loading="lazy" className="avatar-size" />);
    expect(fetcher).not.toHaveBeenCalled();
    const image = screen.getByRole("img", { name: "Avatar" });
    expect(assigned).toHaveBeenCalledWith(image); expect(image).toHaveClass("avatar-size");
    await act(async () => { reveal(); });
    await waitFor(() => expect(image).toHaveAttribute("src", "blob:protected"));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([[401, "UNAUTHENTICATED"], [403, "EMAIL_VERIFICATION_REQUIRED"], [404, "HOUSEHOLD_NOT_FOUND"]] as const)("withdraws a download outside QueryCache on structural %s/%s", async (status, code) => {
    const phases = vi.fn(); const unsubscribe = subscribeSessionInvalidation(phases);
    const operation = captureOperationLifetime();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code, message: "Session authority changed" } }), { status })));
    await expect(downloadProtectedResource("/api/reports/exports/one?download=true")).rejects.toMatchObject({ status, code });
    expect(operation?.active).toBe(false);
    expect(phases.mock.calls.map(([phase]) => phase)).toEqual(["begin", "refresh"]);
    expect(created).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not ask a retired query client to withdraw a second time", async () => {
    const boundary = vi.fn(); const phases = vi.fn();
    const client = createDataQueryClient(boundary, captureOperationLifetime());
    const unsubscribe = subscribeSessionInvalidation(phase => { phases(phase); if (phase === "begin") retireDataClient(client); });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Session expired" } }), { status: 401 })));
    try {
      await client.fetchQuery({ queryKey: ["private-image"], queryFn: () => protectedFetch("/api/receipts/one/thumbnail") }).catch(() => {});
      expect(phases.mock.calls.map(([phase]) => phase)).toEqual(["begin", "refresh"]);
      expect(boundary).not.toHaveBeenCalled();
    } finally { unsubscribe(); client.clear(); }
  });
});
