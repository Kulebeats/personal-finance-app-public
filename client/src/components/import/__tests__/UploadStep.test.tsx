import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TEMPLATE_COLUMNS, TEMPLATE_INSTRUCTIONS } from "@shared/import-template";
import { ImportWizardProvider, useImportWizard, type ParsedData } from "../ImportWizardContext";
import { UploadStep } from "../steps/UploadStep";
import { useImportPreview } from "../useImportPreview";

const { parse, preview } = vi.hoisted(() => ({ parse: vi.fn(), preview: vi.fn() }));
vi.mock("../importApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../importApi")>()),
  parseImportCsv: parse,
  previewImport: preview,
}));

function WizardProbe() {
  const { currentStep, file, mapping, parsedData } = useImportWizard();
  return <output data-testid="probe">{JSON.stringify({ currentStep, file: file?.name, mapping, sheet: parsedData?.sheet })}</output>;
}

function PreviewProbe() {
  const { setTargetAccountId } = useImportWizard();
  useImportPreview();
  return <button type="button" onClick={() => setTargetAccountId("synthetic-account")}>Preview rows</button>;
}

function renderUpload(withPreview = false) {
  const queryClient = new QueryClient();
  const wizard = (showUpload: boolean) => (
    <QueryClientProvider client={queryClient}>
      <ImportWizardProvider>
        {showUpload && <UploadStep />}
        <WizardProbe />
        {withPreview && <PreviewProbe />}
      </ImportWizardProvider>
    </QueryClientProvider>
  );
  const view = render(wizard(true));
  return { showUpload: (show: boolean) => view.rerender(wizard(show)) };
}

const probe = () => JSON.parse(screen.getByTestId("probe").textContent ?? "{}");

function drop(name: string) {
  const type = name.endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const file = new File(["synthetic"], name, { type });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  return file;
}

function deferredParse() {
  let resolve!: (data: ParsedData) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ParsedData>((onSuccess, onError) => {
    resolve = onSuccess;
    reject = onError;
  });
  return { promise, resolve, reject };
}

function deferDroppedFile(file: File) {
  let finishRead!: (entries: unknown[]) => void;
  const readEntries = vi.fn()
    .mockImplementationOnce((accept: typeof finishRead) => { finishRead = accept; })
    .mockImplementationOnce((accept: typeof finishRead) => accept([]));
  fireEvent.drop(document.querySelector('input[type="file"]')!.parentElement!, {
    dataTransfer: {
      types: ["Files"],
      items: [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true, createReader: () => ({ readEntries }) }) }],
    },
  });
  expect(readEntries).toHaveBeenCalledOnce();
  return () => finishRead([{
    isDirectory: false, fullPath: `/${file.name}`, file: (accept: (file: File) => void) => accept(file),
  }]);
}

function deferDropFailure() {
  let failRead!: (error: Error) => void;
  const readEntries = vi.fn((_accept, reject: typeof failRead) => { failRead = reject; });
  fireEvent.drop(document.querySelector('input[type="file"]')!.parentElement!, {
    dataTransfer: {
      types: ["Files"],
      items: [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true, createReader: () => ({ readEntries }) }) }],
    },
  });
  expect(readEntries).toHaveBeenCalledOnce();
  return () => failRead(new Error("Synthetic unreadable directory"));
}

describe("UploadStep Excel support (IMP-01)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("offers the CSV and Excel templates for download", () => {
    renderUpload();
    expect(screen.getByRole("link", { name: /CSV template/ })).toHaveAttribute("href", "/api/import/template.csv");
    const excel = screen.getByRole("link", { name: /Excel template/ });
    expect(excel).toHaveAttribute("href", "/api/import/template.xlsx");
    expect(excel).toHaveAttribute("download");
  });

  it("shows the template's instructions, the same lines as the .xlsx Instructions sheet, for CSV users too", () => {
    renderUpload();
    const instructions = screen.getByTestId("import-template-instructions");
    const [title, ...lines] = TEMPLATE_INSTRUCTIONS;
    expect(instructions.querySelector("summary")).toHaveTextContent(title);
    expect(Array.from(instructions.querySelectorAll("p"), (line) => line.textContent)).toEqual(lines.map((line) => line.trim()));
  });

  it("asks which sheet to read when a workbook has several, and re-reads the chosen one", async () => {
    parse
      .mockResolvedValueOnce({ format: "xlsx", sheets: ["Summary", "Data"], sheet: "Summary", headers: ["Note"], rows: [{ Note: "x" }] })
      .mockResolvedValueOnce({ format: "xlsx", sheets: ["Summary", "Data"], sheet: "Data", headers: ["Date", "Amount"],
        rows: [{ Date: "2026-05-01", Amount: "-1" }, { Date: "2026-05-02", Amount: "-2" }] });
    renderUpload();
    const file = drop("two.xlsx");

    const picker = await screen.findByLabelText(/Which one holds your transactions/);
    expect(parse).toHaveBeenCalledWith(file, undefined);
    expect(probe().currentStep).toBe("upload");
    fireEvent.change(picker, { target: { value: "Data" } });

    await waitFor(() => expect(parse).toHaveBeenLastCalledWith(file, "Data"));
    expect(await screen.findByText(/"Data": 2 rows below the header row/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with this sheet" }));
    expect(probe()).toMatchObject({ currentStep: "column-mapping", sheet: "Data" });
  });

  it("keeps the sheet picker when the first sheet cannot be read, and recovers on another (review r1 P2)", async () => {
    const refusal = Object.assign(new Error('The sheet "Cover" has no rows to import below its header row.'),
      { status: 400, details: { sheets: ["Cover", "Data"], sheet: "Cover" } });
    parse
      .mockRejectedValueOnce(refusal)
      .mockResolvedValueOnce({ format: "xlsx", sheets: ["Cover", "Data"], sheet: "Data", headers: ["Date", "Amount"],
        rows: [{ Date: "2026-05-01", Amount: "-1" }] });
    renderUpload();
    const file = drop("cover.xlsx");

    const picker = await screen.findByLabelText(/Which one holds your transactions/);
    expect(picker).toHaveValue("Cover");
    expect(screen.getByRole("alert")).toHaveTextContent('"Cover" has no rows');
    expect(screen.getByRole("button", { name: "Continue with this sheet" })).toBeDisabled();
    fireEvent.change(picker, { target: { value: "Data" } });

    await waitFor(() => expect(parse).toHaveBeenLastCalledWith(file, "Data"));
    expect(await screen.findByText(/"Data": 1 rows below the header row/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue with this sheet" }));
    expect(probe()).toMatchObject({ currentStep: "column-mapping", sheet: "Data" });
  });

  it("labels sheets that Excel hides (review r2 P2)", async () => {
    parse.mockResolvedValueOnce({ format: "xlsx", sheets: ["Lookup", "Data"], hiddenSheets: ["Lookup"], sheet: "Data",
      headers: ["Date"], rows: [{ Date: "2026-05-01" }] });
    renderUpload();
    drop("hidden.xlsx");

    const picker = await screen.findByLabelText(/Which one holds your transactions/);
    expect(picker).toHaveValue("Data");
    expect(screen.getByRole("option", { name: "Lookup (hidden in Excel)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Data" })).toBeInTheDocument();
  });

  it("goes straight to mapping for a single sheet and maps a filled-in template automatically", async () => {
    const headers = TEMPLATE_COLUMNS.map(column => column.header);
    parse.mockResolvedValueOnce({ format: "xlsx", sheets: ["Transactions"], sheet: "Transactions", headers, rows: [] });
    renderUpload();
    drop("filled.xlsx");

    await waitFor(() => expect(probe().currentStep).toBe("column-mapping"));
    expect(screen.queryByLabelText(/Which one holds your transactions/)).not.toBeInTheDocument();
    expect(probe().mapping).toMatchObject({ date: "Date", merchant: "Description", amount: "Amount",
      debit: "Debit", credit: "Credit", currency: "Currency", reference: "Reference" });
  });

  it("starts a fresh mapping when the file is replaced, so a stale Currency column cannot survive (review r5 P2)", async () => {
    const headers = TEMPLATE_COLUMNS.map(column => column.header);
    parse
      .mockResolvedValueOnce({ format: "xlsx", sheets: ["Transactions"], sheet: "Transactions", headers, rows: [] })
      .mockResolvedValueOnce({ format: "csv", headers: ["Date", "Amount", "CCY"], rows: [{ Date: "2026-05-01", Amount: "-1", CCY: "USD" }] });
    renderUpload();
    drop("filled.xlsx");
    await waitFor(() => expect(probe().mapping).toMatchObject({ currency: "Currency" }));

    drop("statement.csv");
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(probe().mapping).toEqual({ date: "", amount: "" }));
  });

  it("only sends the newer file's rows to preview when the first parse finishes last", async () => {
    const older = deferredParse();
    const newer = deferredParse();
    parse.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    preview.mockResolvedValue({ rows: [] });
    renderUpload(true);
    const oldFile = drop("older.xlsx");
    await waitFor(() => expect(parse).toHaveBeenCalledWith(oldFile, undefined));
    const newFile = drop("newer.csv");
    await waitFor(() => expect(parse).toHaveBeenLastCalledWith(newFile, undefined));

    const newRows = [{ Date: "2026-11-22", Amount: "-17.20" }];
    await act(async () => newer.resolve({ format: "csv", headers: ["Date", "Amount"], rows: newRows }));
    expect(probe()).toMatchObject({ currentStep: "column-mapping", file: "newer.csv" });
    fireEvent.click(screen.getByRole("button", { name: "Preview rows" }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({ rows: newRows })));

    await act(async () => older.resolve({
      format: "xlsx", sheets: ["Transactions"], sheet: "Transactions",
      headers: TEMPLATE_COLUMNS.map(column => column.header),
      rows: [{ Date: "2026-11-01", Amount: "-200.00" }],
    }));
    expect(probe()).toEqual({ currentStep: "column-mapping", file: "newer.csv", mapping: { date: "", amount: "" } });
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it("keeps the newer parse busy when an older file fails while it is reading", async () => {
    const older = deferredParse();
    const newer = deferredParse();
    parse.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    renderUpload();
    drop("older.xlsx");
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    drop("newer.csv");
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(2));

    await act(async () => older.reject(new Error("Older file failed")));
    expect(screen.getByText("Parsing file...")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => newer.reject(new Error("Newer file failed")));
    expect(screen.getByRole("alert")).toHaveTextContent("Newer file failed");
    expect(probe().currentStep).toBe("upload");
  });

  it.each([
    ["unsupported file", [new File(["data"], "invalid.txt", { type: "text/plain" })], /Choose a CSV or Excel/],
    ["too many files", ["one.csv", "two.csv"].map(name => new File(["data"], name, { type: "text/csv" })), /Choose one file at a time/],
  ])("a newer rejected selection (%s) invalidates the pending parse and allows recovery", async (_name, rejected, message) => {
    const older = deferredParse();
    parse.mockReturnValueOnce(older.promise).mockResolvedValueOnce({
      format: "csv", headers: ["Date", "Amount"], rows: [{ Date: "2026-11-22", Amount: "-17.20" }],
    });
    renderUpload();
    const oldFile = drop("older.xlsx");
    await waitFor(() => expect(parse).toHaveBeenCalledWith(oldFile, undefined));
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: rejected } });

    await act(async () => older.resolve({ format: "xlsx", headers: ["Date"], rows: [{ Date: "2026-11-01" }] }));
    expect(probe()).toEqual({ currentStep: "upload", mapping: { date: "", amount: "" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(parse).toHaveBeenCalledTimes(1);

    drop("recovery.csv");
    await waitFor(() => expect(probe()).toMatchObject({ currentStep: "column-mapping", file: "recovery.csv" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("cannot start a parse from a deferred drop after the upload step closes and reopens", async () => {
    const { showUpload } = renderUpload();
    const late = new File(["data"], "late.csv", { type: "text/csv" });
    parse.mockResolvedValue({ format: "csv", headers: ["Date"], rows: [{ Date: "2026-11-22" }] });
    const finishRead = deferDroppedFile(late);
    showUpload(false);
    showUpload(true);

    await act(async () => finishRead());
    expect(parse).not.toHaveBeenCalled();
    expect(probe().currentStep).toBe("upload");

    drop("reopened.csv");
    await waitFor(() => expect(probe()).toMatchObject({ currentStep: "column-mapping", file: "reopened.csv" }));
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("clears the old busy state when the latest selection cannot be extracted and allows recovery", async () => {
    const older = deferredParse();
    const ready: ParsedData = { format: "csv", headers: ["Date"], rows: [{ Date: "2026-11-22" }] };
    parse.mockReturnValueOnce(older.promise).mockResolvedValueOnce(ready);
    renderUpload();
    drop("older.csv");
    await screen.findByText("Parsing file...");

    const failLatestDrop = deferDropFailure();
    await act(async () => failLatestDrop());
    expect(screen.queryByText("Parsing file...")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to read this file");
    await act(async () => older.resolve(ready));
    expect(probe().currentStep).toBe("upload");
    expect(parse).toHaveBeenCalledTimes(1);

    drop("recovery.csv");
    await waitFor(() => expect(probe()).toMatchObject({ currentStep: "column-mapping", file: "recovery.csv" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores an earlier extraction failure and drag-hover failure while the newer parse is pending", async () => {
    const newer = deferredParse();
    parse.mockReturnValueOnce(newer.promise);
    renderUpload();
    const failOlderDrop = deferDropFailure();
    drop("newer.csv");
    await screen.findByText("Parsing file...");

    const unreadableHover = {
      types: ["Files"],
      get items() { throw new Error("Synthetic hover failure"); },
    };
    await act(async () => {
      fireEvent.dragEnter(document.querySelector('input[type="file"]')!.parentElement!, { dataTransfer: unreadableHover });
      failOlderDrop();
    });
    expect(screen.getByText("Parsing file...")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => newer.resolve({ format: "csv", headers: ["Date"], rows: [{ Date: "2026-11-22" }] }));
    expect(probe()).toMatchObject({ currentStep: "column-mapping", file: "newer.csv" });
  });

  it.each([["older.csv", "text/csv"], ["older.txt", "text/plain"]])(
    "an earlier drop resolving to %s cannot supersede a newer selection during its parse",
    async (name, type) => {
      renderUpload();
      const finishOlderDrop = deferDroppedFile(new File(["data"], name, { type }));
      const newer = deferredParse();
      parse.mockReturnValueOnce(newer.promise).mockResolvedValue({ format: "csv", headers: ["Old"], rows: [{ Old: "stale" }] });
      const picked = drop("newer.csv");
      await waitFor(() => expect(parse).toHaveBeenCalledExactlyOnceWith(picked, undefined));

      const root = document.querySelector('input[type="file"]')!.parentElement!;
      await act(async () => fireEvent.dragEnter(root, {
        dataTransfer: { types: ["Files"], items: [{ kind: "file", type: "text/csv" }] },
      }));
      await act(async () => finishOlderDrop());
      expect(parse).toHaveBeenCalledExactlyOnceWith(picked, undefined);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByText("Parsing file...")).toBeInTheDocument();

      await act(async () => newer.resolve({
        format: "csv", headers: ["Date"], rows: [{ Date: "2026-11-22" }],
      }));
      expect(probe()).toMatchObject({ currentStep: "column-mapping", file: "newer.csv" });
    },
  );
});
