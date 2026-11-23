import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { ImportWizardProvider, useImportWizard } from "../ImportWizardContext";
import { ColumnAssignmentStep } from "../steps/ColumnAssignmentStep";
import { ReviewStep } from "../steps/ReviewStep";
import { ProgressModal } from "../steps/ProgressModal";
import { ImportTransactionsModal } from "../../accounts/ImportTransactionsModal";

const { mutateAsync, execute, preview } = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue({ imported: 1 }),
  execute: vi.fn().mockResolvedValue({ imported: 1, skipped: 0, deleted: 0 }),
  // NEW-17: the review step waits for the server duplicate check before importing.
  preview: vi.fn().mockResolvedValue({ rows: [], errors: [],
    counts: { new: 1, duplicate: 0, candidate: 0, conflict: 0, failed: 0 } }),
}));
vi.mock("@/hooks", () => ({ useImportTransactions: () => ({ mutateAsync, isPending: false }) }));
// The real helpers (referenceDisplaysFor) with the two network calls stubbed.
vi.mock("../importApi", async importOriginal => ({
  ...(await importOriginal<typeof import("../importApi")>()), executeImport: execute, previewImport: preview,
}));

function GlobalHarness({ rawDate }: { rawDate: string }) {
  const wizard = useImportWizard();
  useEffect(() => {
    wizard.setParsedData({ headers: ["Date", "Amount"], rows: [{ Date: rawDate, Amount: "1.00" }] });
    wizard.updateMapping("date", "Date");
    wizard.updateMapping("amount", "Amount");
    wizard.setTargetAccountId("account");
  }, [rawDate]);
  if (wizard.currentStep === "progress") return <ProgressModal />;
  return <><ColumnAssignmentStep /><ReviewStep /></>;
}

function renderGlobal(rawDate: string) {
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false, staleTime: Infinity, queryFn: async () => ({ success: true, data: [] }),
  } } });
  client.setQueryData(["/api/accounts"], { success: true, data: [] });
  const view = render(<QueryClientProvider client={client}><ImportWizardProvider>
    <GlobalHarness rawDate={rawDate} />
  </ImportWizardProvider></QueryClientProvider>);
  return { ...view, client };
}

function renderAccount() {
  return render(<ImportTransactionsModal accountId="account" accountName="Test"
    open onOpenChange={vi.fn()} />);
}
function upload(date: string) {
  const csv = `Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags\n${date},Shop,,,,,1.00,`;
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File([csv], "dates.csv", { type: "text/csv" })] },
  });
}

describe("both import entrances bind date preview to submission (UNIT)", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(["success", "error"])("refreshes affected views after the dispatched global import returns %s", async outcome => {
    if (outcome === "error") {
      execute.mockRejectedValueOnce(new Error("Import response could not be confirmed"));
      globalThis.expectConsoleMessage?.("error", /Import response could not be confirmed/);
    }
    const { client } = renderGlobal("2026-01-10");
    const keys = [
      ["accounts", "detail", "account"],
      ["transactions", "infinite", { accountId: "account" }],
      ["reports", "debt", { from: "2026-01-01" }],
      ["budgets", "alerts", 2026, 1],
      ["reports", "netWorth", { from: "2026-01-01", to: "2026-01-31" }],
    ];
    let releaseOld!: (value: string) => void;
    const oldRead = new Promise<string>(resolve => { releaseOld = resolve; });
    const read = vi.fn().mockReturnValueOnce(oldRead).mockResolvedValue("4454.50");
    const observer = new QueryObserver(client, { queryKey: ["reports", "netWorth", { scope: "mine" }], queryFn: read });
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(read).toHaveBeenCalledOnce();
      expect(observer.getCurrentResult().data).toBeUndefined();
      for (const key of keys) client.setQueryData(key, "before import");
      const submit = screen.getByRole("button", { name: "Import Transactions" });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);
      const message = outcome === "error" ? "Import response could not be confirmed" : "Import Successful!";
      expect(await screen.findByText(message, {}, { timeout: 5000 })).toBeInTheDocument();
      expect(execute).toHaveBeenCalledOnce();
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
      expect(read).toHaveBeenCalledTimes(2);
      expect(observer.getCurrentResult().data).toBe("4454.50");
      await act(async () => { releaseOld("4500.00"); await oldRead; });
      expect(observer.getCurrentResult().data).toBe("4454.50");
    } finally {
      releaseOld("4500.00");
      unsubscribe();
    }
  });

  it("does not refresh a retired client when the dispatched import finishes", async () => {
    const original = createOperationLifetime(), replacement = createOperationLifetime();
    activateOperationLifetime(original);
    let finish!: () => void;
    execute.mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve({ imported: 1, skipped: 0, deleted: 0 });
    }));
    try {
      const { client } = renderGlobal("2026-01-10");
      const key = ["reports", "netWorth"];
      client.setQueryData(key, "original household");
      const submit = screen.getByRole("button", { name: "Import Transactions" });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);
      await waitFor(() => expect(execute).toHaveBeenCalledOnce(), { timeout: 5000 });
      activateOperationLifetime(replacement);
      globalThis.expectConsoleMessage?.("error", /Your session changed/);
      await act(async () => { finish(); });
      expect(await screen.findByText("Import Failed")).toBeInTheDocument();
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    } finally {
      retireOperationLifetime(replacement);
      retireOperationLifetime(original);
    }
  });

  it("does not dispatch the pending CSV after the household changes", async () => {
    const original = createOperationLifetime(), replacement = createOperationLifetime();
    activateOperationLifetime(original);
    try {
      renderGlobal("2026-01-10");
      const submit = screen.getByRole("button", { name: "Import Transactions" });
      await waitFor(() => expect(submit).toBeEnabled());
      fireEvent.click(submit);
      activateOperationLifetime(replacement);
      globalThis.expectConsoleMessage?.("error", /Your session changed/);
      expect(await screen.findByText("Import Failed", {}, { timeout: 5000 })).toBeInTheDocument();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      retireOperationLifetime(replacement);
      retireOperationLifetime(original);
    }
  });
  it("global preview refuses ambiguous input until selection, then submits its displayed day", async () => {
    renderGlobal("01/02/2026");
    expect(await screen.findByText(/Ambiguous date: choose/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Transactions" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("CSV date format"), { target: { value: "DD/MM/YYYY" } });
    expect(await screen.findByText("2026-02-01")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import Transactions" }));
    await waitFor(() => expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      dateFormat: "DD/MM/YYYY", rows: [{ Date: "01/02/2026", Amount: "1.00" }],
    })), { timeout: 2500 });
  });
  it("global preview blocks an impossible row", async () => {
    renderGlobal("2026-02-30");
    expect(await screen.findByText(/calendar day does not exist/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Transactions" })).toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
  });
  it("global preview recomputes when source data changes", async () => {
    const view = renderGlobal("2028-02-29");
    expect(await screen.findByText("2028-02-29", { selector: "td:last-child" })).toBeInTheDocument();
    view.rerender(<QueryClientProvider client={new QueryClient({ defaultOptions: {
      queries: { queryFn: async () => ({ success: true, data: [] }) },
    } })}><ImportWizardProvider><GlobalHarness rawDate="2026-02-30" /></ImportWizardProvider></QueryClientProvider>);
    expect(await screen.findByText(/calendar day does not exist/)).toBeInTheDocument();
    expect(screen.queryByText("2028-02-29")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Transactions" })).toBeDisabled();
  });
  it("account preview recomputes after a format change and submits exactly that day", async () => {
    renderAccount(); upload("01/02/2026");
    expect(await screen.findByText(/Ambiguous date: choose/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("CSV date format"), { target: { value: "DD/MM/YYYY" } });
    expect(await screen.findByText("2026-02-01")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("CSV date format"), { target: { value: "MM/DD/YYYY" } });
    expect(await screen.findByText("2026-01-02")).toBeInTheDocument();
    expect(screen.queryByText("2026-02-01")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add 1 transactions" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      transactions: [expect.objectContaining({ date: "2026-01-02" })],
    })));
  });
  it("account preview blocks impossible dates before submission", async () => {
    renderAccount(); upload("2026-02-30");
    expect(await screen.findByText(/calendar day does not exist/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add .* transactions/ })).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
  it("account removal invalidates the preview before reading replacement data", async () => {
    renderAccount(); upload("2028-02-29");
    expect(await screen.findByText("2028-02-29")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("2028-02-29")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add 0 transactions" })).toBeDisabled();
    upload("2026-02-30");
    expect(await screen.findByText(/calendar day does not exist/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add 0 transactions" })).toBeDisabled();
  });
  it("a late file read cannot restore a removed account preview", async () => {
    const readers: { onload?: (event: { target: { result: string } }) => void }[] = [];
    class DelayedReader {
      onload?: (event: { target: { result: string } }) => void;
      readAsText() { readers.push(this); }
    }
    vi.stubGlobal("FileReader", DelayedReader);
    try {
      renderAccount(); upload("2028-02-29");
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
      upload("2026-03-14");
      act(() => readers[1].onload!({ target: {
        result: "Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags\n2026-03-14,Shop,,,,,1.00,",
      } }));
      expect(await screen.findByText("2026-03-14")).toBeInTheDocument();
      act(() => readers[0].onload!({ target: {
        result: "Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags\n2028-02-29,Shop,,,,,1.00,",
      } }));
      expect(screen.queryByText("2028-02-29")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Add 1 transactions" }));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        transactions: [expect.objectContaining({ date: "2026-03-14" })],
      })));
    } finally { vi.unstubAllGlobals(); }
  });
  it("uses the current format when an account file read completes", async () => {
    let finishRead: ((event: { target: { result: string } }) => void) | undefined;
    class DelayedReader {
      onload?: typeof finishRead;
      readAsText() { finishRead = this.onload; }
    }
    vi.stubGlobal("FileReader", DelayedReader);
    try {
      renderAccount();
      fireEvent.change(screen.getByLabelText("CSV date format"), { target: { value: "DD/MM/YYYY" } });
      upload("01/02/2026");
      expect(screen.getByRole("button", { name: "Add 0 transactions" })).toBeDisabled();
      fireEvent.change(screen.getByLabelText("CSV date format"), { target: { value: "MM/DD/YYYY" } });
      act(() => finishRead!({ target: {
        result: "Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags\n01/02/2026,Shop,,,,,1.00,",
      } }));
      expect(await screen.findByText("2026-01-02")).toBeInTheDocument();
      expect(screen.queryByText("2026-02-01")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Add 1 transactions" }));
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        transactions: [expect.objectContaining({ date: "2026-01-02" })],
      })));
    } finally { vi.unstubAllGlobals(); }
  });
});
