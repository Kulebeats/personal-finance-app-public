import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOcrProcessor } from "../useOcrProcessor";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

type CreateWorker = (language: string, oem: number, options: Record<string, unknown>) => Promise<unknown>;
const mocks = vi.hoisted(() => ({ createWorker: vi.fn<CreateWorker>() }));
vi.mock("tesseract.js", () => ({ createWorker: mocks.createWorker }));

describe("OCR runtime asset paths (OPS-004)", () => {
  beforeEach(() => { mocks.createWorker.mockReset(); activateOperationLifetime(createOperationLifetime({ subject: "a" })); });
  afterEach(() => { cleanup(); retireOperationLifetime(); });

  it("starts tesseract.js from same-origin self-hosted files, never a CDN or blob: worker", async () => {
    const worker = { recognize: vi.fn(async () => ({ data: { text: "TOTAL 10.00" } })), terminate: vi.fn(async () => {}) };
    mocks.createWorker.mockResolvedValue(worker);
    const view = renderHook(() => useOcrProcessor());

    await act(async () => { await view.result.current.processImage("blob:receipt"); });

    expect(mocks.createWorker).toHaveBeenCalledOnce();
    const [language, oem, options] = mocks.createWorker.mock.calls[0];
    expect([language, oem]).toEqual(["eng", 1]);
    expect(options).toMatchObject({
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr/core",
      langPath: "/ocr/lang",
      workerBlobURL: false,
    });
    for (const key of ["workerPath", "corePath", "langPath"] as const) {
      // A root-relative path resolves against the page origin; "//host" would not.
      expect(options[key]).toMatch(/^\/(?!\/)/);
    }
  });
});
