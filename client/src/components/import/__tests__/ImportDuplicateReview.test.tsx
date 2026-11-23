/**
 * @vitest-environment jsdom
 *
 * NEW-17: the review step asks the server preview with the CHOSEN date format,
 * lists duplicate candidates, defaults each one to "skip", and lets the user
 * import it instead. The server contract is proven in
 * server/routes/__tests__/completion-r09.import-identity.realdb.integration.test.ts.
 */
import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { ImportWizardProvider, useImportWizard } from "../ImportWizardContext";
import { ImportDuplicateReview } from "../ImportDuplicateReview";
import { useImportPreview } from "../useImportPreview";
import type { ImportPreviewResult } from "../importApi";

const preview: ImportPreviewResult = {
  identityVersion: "csv-import:v2", fingerprint: "f".repeat(64), dateFormat: "DD/MM/YYYY", strategy: "prioritize_coppercoin",
  rows: [
    { ordinal: 1, date: "2026-04-03", type: "expense", amount: "4.50", merchant: "Lunch", notes: null, reference: null, status: "new" },
    { ordinal: 2, date: "2026-04-03", type: "expense", amount: "4.50", merchant: "Coffee", notes: null, reference: null, status: "candidate",
      candidate: { id: "tx-1", name: "Coffee", date: "2026-04-03", amount: "4.50", reason: "same_merchant" } },
  ],
  errors: [],
  counts: { new: 1, duplicate: 0, candidate: 1, conflict: 0, failed: 0 },
  removals: [],
  accountCurrency: "ZMW",
};

const mockPreview = vi.fn();
const json = (data: unknown): Response =>
  ({ ok: true, headers: { get: () => "application/json" }, json: vi.fn().mockResolvedValue(data) }) as unknown as Response;

function Harness() {
  const { setParsedData, setTargetAccountId, setDateFormat, updateMapping, skipRowOrdinals, reviewedRemovals } = useImportWizard();
  useEffect(() => {
    setParsedData({ headers: ["Date", "Amount", "Merchant"], rows: [
      { Date: "03/04/2026", Amount: "-4.50", Merchant: "Lunch" },
      { Date: "03/04/2026", Amount: "-4.50", Merchant: "Coffee" },
    ] });
    updateMapping("date", "Date");
    updateMapping("amount", "Amount");
    setDateFormat("DD/MM/YYYY");
    setTargetAccountId("acc-1");
  }, []);
  const query = useImportPreview();
  return (
    <>
      <ImportDuplicateReview preview={query.data} isLoading={query.isLoading} error={query.error} />
      <output data-testid="skip">{skipRowOrdinals.join(",")}</output>
      <output data-testid="reviewed">{JSON.stringify(reviewedRemovals)}</output>
    </>
  );
}

describe("ImportDuplicateReview", () => {
  beforeEach(() => {
    clearCsrfToken();
    mockPreview.mockResolvedValue(json(preview));
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/csrf-token") ? Promise.resolve(json({ csrfToken: "test-csrf" })) : mockPreview(input, init)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("previews with the chosen date format and defaults the candidate to skip, which the user can undo", async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ImportWizardProvider><Harness /></ImportWizardProvider>
      </QueryClientProvider>,
    );
    const checkbox = await screen.findByRole("checkbox", { name: /Skip row 2: Coffee/ });
    expect(checkbox).toBeChecked();
    expect(screen.getByTestId("skip")).toHaveTextContent("2");
    expect(screen.getByTestId("import-preview-counts")).toHaveTextContent("1 new, 0 already imported, 1 possible duplicate, 0 with errors.");
    const [url, init] = mockPreview.mock.calls.at(-1)!;
    expect(String(url)).toContain("/import/preview");
    expect(JSON.parse(String(init.body))).toMatchObject({ targetAccountId: "acc-1", dateFormat: "DD/MM/YYYY",
      mapping: { date: "Date", amount: "Amount" } });

    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(screen.getByTestId("skip")).toHaveTextContent("");
  });

  it("lists the rows a CSV-wins import removes and binds exactly those to execute (A-02)", async () => {
    const version = "a".repeat(64);
    mockPreview.mockResolvedValue(json({ ...preview, strategy: "prioritize_csv", rows: [preview.rows[0]],
      counts: { ...preview.counts, candidate: 0 },
      removals: [{ id: "tx-9", date: "2026-04-03", name: "Manual taxi", type: "expense", amount: { amount: "12.00", currency: "USD" }, version }] }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ImportWizardProvider><Harness /></ImportWizardProvider>
      </QueryClientProvider>,
    );
    const removals = await screen.findByTestId("import-overwrite-removals");
    expect(removals).toHaveTextContent("This import removes 1 ledger row");
    expect(removals).toHaveTextContent("2026-04-03: Manual taxi -12.00 USD");
    expect(JSON.parse(screen.getByTestId("reviewed").textContent ?? "")).toEqual([{ id: "tx-9", version }]);
  });
});
