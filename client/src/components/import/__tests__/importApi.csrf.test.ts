/**
 * @vitest-environment jsdom
 *
 * CSRF long-tail (§4b): the CSV import wizard's parse (FormData upload) and
 * execute calls must carry x-csrf-token. The parse upload must NOT get a JSON
 * content-type — the browser sets the multipart boundary itself.
 *
 * NOTE: /api/import/parse and /api/import/execute return raw JSON (no V7
 * envelope — see server/routes/import.ts res.json(result)), so these helpers
 * pass the body through unchanged.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { parseImportCsv, executeImport, referenceDisplaysFor } from "../importApi";

const mockFetch = vi.fn();

const mockFetchResponse = (data: unknown, ok = true): Response =>
  ({
    ok,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(data),
  }) as unknown as Response;

describe("import wizard API helpers", () => {
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

  it("parseImportCsv uploads FormData with x-csrf-token and no JSON content-type", async () => {
    const parsed = {
      headers: ["Date", "Amount"],
      rows: [{ Date: "2026-01-01", Amount: "5" }],
    };
    mockFetch.mockResolvedValue(mockFetchResponse(parsed));

    const file = new File(["Date,Amount"], "txns.csv", { type: "text/csv" });
    const result = await parseImportCsv(file);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/import/parse",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "x-csrf-token": "test-csrf" }),
      }),
    );
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBe(file);
    expect(
      (init.headers as Record<string, string>)["Content-Type"],
    ).toBeUndefined();
    // Raw (non-envelope) body passes through unchanged.
    expect(result).toEqual(parsed);
  });

  it("executeImport POSTs JSON with x-csrf-token and passes the result through", async () => {
    const outcome = { imported: 3, skipped: 1, deleted: 0 };
    mockFetch.mockResolvedValue(mockFetchResponse(outcome));

    const payload = {
      targetAccountId: "acc-1",
      strategy: "prioritize_csv" as const,
      mapping: { date: "Date", amount: "Amount" },
      dateFormat: "DD/MM/YYYY" as const,
      categoryMapping: {},
      rows: [{ Date: "2026-01-01", Amount: "5" }],
      batchId: "00000000-0000-4000-8000-000000000001",
      skipRowOrdinals: [],
      reviewedRemovals: [],
      postRows: [],
      skipRows: [],
    };
    const result = await executeImport(payload);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/import/execute",
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
    expect(result).toEqual(outcome);
  });

  it("sends only the Excel displays of the column mapped as Reference (review r6)", () => {
    const referenceDisplays = [
      { row: 1, column: "Ref", text: "000123" },
      { row: 1, column: "Amount", text: "000123" },
    ];
    const parsed = { headers: ["Date", "Amount", "Ref"], rows: [], referenceDisplays };
    expect(referenceDisplaysFor(parsed, { date: "Date", amount: "Amount", reference: "Ref" })).toEqual([referenceDisplays[0]]);
    expect(referenceDisplaysFor(parsed, { date: "Date", amount: "Amount" })).toEqual([]);
  });
});
