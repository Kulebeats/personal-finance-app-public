/**
 * @vitest-environment jsdom
 *
 * CSRF long-tail (§4b): POST /api/reports/exports is called from three places
 * (Reports page, CashFlow page, merchant detail). All three now share
 * requestReportExport, which must carry x-csrf-token.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { requestReportExport } from "@/hooks/use-reports";

const mockFetch = vi.fn();

const mockFetchResponse = (data: unknown, ok = true): Response =>
  ({
    ok,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(data),
  }) as unknown as Response;

describe("requestReportExport", () => {
  beforeEach(() => {
    clearCsrfToken();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/csrf-token")) {
          return Promise.resolve(mockFetchResponse({ csrfToken: "test-csrf" }));
        }
        return mockFetch(input, init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("POSTs the export request with x-csrf-token and returns the export id", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: { id: "exp-1" } }),
    );

    const payload = {
      reportType: "cashflow",
      format: "csv",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    };
    const id = await requestReportExport(payload);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/reports/exports",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "x-csrf-token": "test-csrf",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(payload),
      }),
    );
    expect(id).toBe("exp-1");
  });

  it("throws 'Export failed' when the response carries no export id", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: {} }),
    );

    await expect(
      requestReportExport({ reportType: "cashflow", format: "csv" }),
    ).rejects.toThrow("Export failed");
  });

  it("surfaces the server error message on failure", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse(
        { success: false, error: { message: "Range too large" } },
        false,
      ),
    );

    await expect(
      requestReportExport({ reportType: "cashflow", format: "csv" }),
    ).rejects.toThrow("Range too large");
  });
});
