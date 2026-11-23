import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOcrProcessor } from "../useOcrProcessor";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

const mocks = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock("tesseract.js", () => ({ createWorker: mocks.createWorker }));
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }

describe("OCR operation ownership", () => {
  beforeEach(() => { mocks.createWorker.mockReset(); activateOperationLifetime(createOperationLifetime({ subject: "a" })); });
  afterEach(() => { cleanup(); retireOperationLifetime(); });

  it("suppresses stale OCR callbacks and terminates only the stale worker", async () => {
    const oldResult = deferred<{ data: { text: string } }>();
    const nextResult = deferred<{ data: { text: string } }>();
    const oldWorker = { recognize: vi.fn(() => oldResult.promise), terminate: vi.fn(async () => {}) };
    const nextWorker = { recognize: vi.fn(() => nextResult.promise), terminate: vi.fn(async () => {}) };
    mocks.createWorker.mockResolvedValueOnce(oldWorker).mockResolvedValueOnce(nextWorker);
    const success = vi.fn();
    const view = renderHook(() => useOcrProcessor({ onSuccess: success }));
    let old!: Promise<void>; let next!: Promise<void>;
    act(() => { old = view.result.current.processImage("blob:old"); });
    await waitFor(() => expect(oldWorker.recognize).toHaveBeenCalled());
    activateOperationLifetime(createOperationLifetime({ subject: "b" }));
    act(() => { next = view.result.current.processImage("blob:next"); });
    await waitFor(() => expect(nextWorker.recognize).toHaveBeenCalled());
    await act(async () => { oldResult.resolve({ data: { text: "Old receipt" } }); await old; });
    expect(success).not.toHaveBeenCalled();
    expect(oldWorker.terminate).toHaveBeenCalledOnce(); expect(nextWorker.terminate).not.toHaveBeenCalled();
    await act(async () => { nextResult.resolve({ data: { text: "Current receipt" } }); await next; });
    expect(success).toHaveBeenCalledOnce();
    view.unmount(); expect(nextWorker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates a worker created after its originating view unmounted", async () => {
    const created = deferred<{ recognize: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }>();
    const worker = { recognize: vi.fn(), terminate: vi.fn(async () => {}) };
    mocks.createWorker.mockReturnValue(created.promise);
    const view = renderHook(() => useOcrProcessor());
    let pending!: Promise<void>;
    act(() => { pending = view.result.current.processImage("blob:old"); });
    await waitFor(() => expect(mocks.createWorker).toHaveBeenCalled());
    view.unmount();
    created.resolve(worker); await pending;
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(worker.recognize).not.toHaveBeenCalled();
  });

  it("keeps progress reporting active when a sequential scan reuses an idle worker", async () => {
    let log!: (message: { status: string; progress: number }) => void;
    const second = deferred<{ data: { text: string } }>();
    const worker = { recognize: vi.fn().mockResolvedValueOnce({ data: { text: "First" } }).mockReturnValueOnce(second.promise), terminate: vi.fn(async () => {}) };
    mocks.createWorker.mockImplementation(async (_language: string, _mode: number, options: { logger: typeof log }) => { log = options.logger; return worker; });
    const view = renderHook(() => useOcrProcessor());
    await act(async () => { await view.result.current.processImage("blob:first"); });
    let pending!: Promise<void>;
    act(() => { pending = view.result.current.processImage("blob:second"); });
    await waitFor(() => expect(worker.recognize).toHaveBeenCalledTimes(2));
    act(() => log({ status: "recognizing text", progress: 0.5 }));
    expect(view.result.current.progress).toBe(50);
    expect(view.result.current.status).toBe("Reading text...");
    await act(async () => { second.resolve({ data: { text: "Second" } }); await pending; });
    expect(mocks.createWorker).toHaveBeenCalledOnce();
  });
});
