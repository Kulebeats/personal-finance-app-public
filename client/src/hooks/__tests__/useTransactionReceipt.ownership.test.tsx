import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTransactionReceipt } from "../useTransactionReceipt";
import { createDataQueryClient } from "@/lib/queryClient";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { clearCsrfToken } from "@/lib/csrf";

const mocks = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock("tesseract.js", () => ({ createWorker: mocks.createWorker }));
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const textA = "ALPHA SHOP\nTOTAL 10.00";
const textB = "BETA SHOP\nTOTAL 20.00";

describe("actual transaction-receipt ownership through prefetch and OCR", () => {
  const blobA = new Blob(["A"]); const blobB = new Blob(["B"]);
  let responseA: Response; let responseB: Response;
  let writes: { url: string; body: { rawText?: string } }[];
  let recognize: ReturnType<typeof vi.fn>;
  const revoked = vi.fn();

  beforeEach(() => {
    writes = []; clearCsrfToken(); mocks.createWorker.mockReset(); revoked.mockReset();
    responseA = new Response(); responseB = new Response();
    vi.spyOn(responseA, "blob").mockResolvedValue(blobA); vi.spyOn(responseB, "blob").mockResolvedValue(blobB);
    recognize = vi.fn(async (url: string) => ({ data: { text: url === "blob:A" ? textA : textB } }));
    mocks.createWorker.mockImplementation(async () => ({ recognize, terminate: vi.fn(async () => {}) }));
    vi.stubGlobal("URL", class extends URL { static createObjectURL = (blob: Blob) => blob === blobA ? "blob:A" : "blob:B"; static revokeObjectURL = revoked; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/receipts/A/ocr-image") return responseA;
      if (url === "/api/receipts/B/ocr-image") return responseB;
      if (url === "/api/csrf-token") return new Response(JSON.stringify({ csrfToken: "token" }));
      if (url.endsWith("/ocr-results")) { writes.push({ url, body: JSON.parse(String(init?.body)) }); return new Response(JSON.stringify({ success: true, data: {} })); }
      throw new Error(`Unexpected receipt request: ${url}`);
    }));
  });
  afterEach(() => { cleanup(); retireOperationLifetime(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function renderReceipt() {
    const operation = createOperationLifetime({ subject: "a", household: "one" }); activateOperationLifetime(operation);
    const client = createDataQueryClient(undefined, operation); const autofill = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return { ...renderHook(() => useTransactionReceipt({ onAutofill: autofill }), { wrapper }), client, autofill };
  }

  it("does not start stale A OCR after B completed while A bytes were delayed", async () => {
    const bytesA = deferred<Blob>(); vi.mocked(responseA.blob).mockReturnValue(bytesA.promise);
    const view = renderReceipt();
    act(() => view.result.current.handleReceiptUploadSuccess("A"));
    await waitFor(() => expect(responseA.blob).toHaveBeenCalled());
    act(() => view.result.current.handleReceiptUploadSuccess("B"));
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => { bytesA.resolve(blobA); });
    await waitFor(() => expect(revoked).toHaveBeenCalledWith("blob:A"));
    expect(writes).toEqual([{ url: "/api/receipts/B/ocr-results", body: expect.objectContaining({ rawText: textB }) }]);
    expect(recognize).toHaveBeenCalledTimes(1); expect(view.autofill).toHaveBeenCalledTimes(1);
    view.client.clear();
  });

  it("retires in-flight A OCR immediately when B upload starts before B bytes finish", async () => {
    const resultA = deferred<{ data: { text: string } }>(); const bytesB = deferred<Blob>();
    recognize.mockImplementation((url: string) => url === "blob:A" ? resultA.promise : Promise.resolve({ data: { text: textB } }));
    vi.mocked(responseB.blob).mockReturnValue(bytesB.promise);
    const view = renderReceipt();
    act(() => view.result.current.handleReceiptUploadSuccess("A"));
    await waitFor(() => expect(recognize).toHaveBeenCalledWith("blob:A"));
    act(() => view.result.current.handleReceiptUploadSuccess("B"));
    await waitFor(() => expect(responseB.blob).toHaveBeenCalled());
    await act(async () => { resultA.resolve({ data: { text: textA } }); });
    expect(writes).toEqual([]); expect(view.autofill).not.toHaveBeenCalled();
    await act(async () => { bytesB.resolve(blobB); });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ url: "/api/receipts/B/ocr-results", body: { rawText: textB } });
    expect(view.autofill).toHaveBeenCalledOnce(); view.client.clear();
  });

  it("clearing a receipt retires its prefetched bytes before any OCR worker starts", async () => {
    const bytesA = deferred<Blob>(); vi.mocked(responseA.blob).mockReturnValue(bytesA.promise);
    const view = renderReceipt();
    act(() => view.result.current.handleReceiptUploadSuccess("A"));
    await waitFor(() => expect(responseA.blob).toHaveBeenCalled());
    act(() => view.result.current.clearReceipt());
    await act(async () => { bytesA.resolve(blobA); });
    await waitFor(() => expect(revoked).toHaveBeenCalledWith("blob:A"));
    expect(mocks.createWorker).not.toHaveBeenCalled(); expect(writes).toEqual([]); expect(view.autofill).not.toHaveBeenCalled();
    view.client.clear();
  });
});
