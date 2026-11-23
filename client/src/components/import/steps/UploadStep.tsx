import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { fromEvent } from "file-selector";
import { ErrorCode, useDropzone, type DropEvent, type FileRejection } from "react-dropzone";
import { useImportWizard, type ParsedData } from "../ImportWizardContext";
import { Button } from "@/components/ui/button";
import {
  FileSpreadsheet,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { ApiError } from "@/lib/api";
import { parseImportCsv } from "../importApi";
import { templateMappingFor } from "../templateMapping";
import { SheetPicker } from "./SheetPicker";
import { TemplateDownloads } from "./TemplateDownloads";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface PendingWorkbook {
  file: File;
  data: ParsedData;
}

/** IMP-01 review r1 P2: a per-sheet refusal still lists the workbook's sheets. */
const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];

function sheetsOfError(err: unknown): { sheets: string[]; hiddenSheets: string[]; sheet?: string } {
  const details = (err as ApiError | undefined)?.details as { sheets?: unknown; sheet?: unknown; hiddenSheets?: unknown } | undefined;
  return { sheets: stringList(details?.sheets), hiddenSheets: stringList(details?.hiddenSheets),
    sheet: typeof details?.sheet === "string" ? details.sheet : undefined };
}

export function UploadStep() {
  const { setFile, setParsedData, setStep, updateMapping } = useImportWizard();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // IMP-01: a workbook with several sheets waits here for the sheet choice.
  const [pending, setPending] = useState<PendingWorkbook | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const parseVersion = useRef(0);
  const selectionVersions = useRef(new WeakMap<DropEvent, number>());
  const active = useRef(false);

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      parseVersion.current++;
    };
  }, []);

  const proceed = useCallback(
    (file: File, data: ParsedData) => {
      if (!active.current) return;
      setFile(file);
      setParsedData(data);
      templateMappingFor(data.headers)?.forEach(([field, header]) => updateMapping(field, header));
      setStep("column-mapping");
    },
    [setFile, setParsedData, setStep, updateMapping]
  );

  const parse = useCallback(async (file: File, sheet?: string) => {
    if (!active.current) return;
    const version = ++parseVersion.current;
    const isLatest = () => active.current && parseVersion.current === version;
    if (sheet === undefined) setPending(null);
    setIsUploading(true);
    setError(null);
    setSheetError(null);
    try {
      // Goes through apiCall so the upload carries x-csrf-token.
      const data = await parseImportCsv(file, sheet);
      if (!isLatest()) return;
      if ((data.sheets?.length ?? 0) > 1) {
        setPending({ file, data });
      } else {
        proceed(file, data);
      }
    } catch (err) {
      if (!isLatest()) return;
      const message = err instanceof Error ? err.message : "Unable to read this file";
      const { sheets, hiddenSheets, sheet: failedSheet } = sheetsOfError(err);
      if (sheets.length > 1) {
        // Keep the picker so another sheet can be chosen.
        setPending({ file, data: { format: "xlsx", headers: [], rows: [], sheets, hiddenSheets, sheet: failedSheet ?? sheet ?? sheets[0] } });
        setSheetError(message);
      } else {
        setPending(null);
        setError(message);
      }
    } finally {
      if (isLatest()) setIsUploading(false);
    }
  }, [proceed]);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejections: FileRejection[], event: DropEvent) => {
      if (!active.current || selectionVersions.current.get(event) !== parseVersion.current) return;
      const file = acceptedFiles[0];
      if (!file || rejections.length > 0) {
        setPending(null);
        setSheetError(null);
        setIsUploading(false);
        const tooMany = rejections.some(rejection => rejection.errors.some(({ code }) => code === ErrorCode.TooManyFiles));
        setError(tooMany ? "Choose one file at a time." : "Choose a CSV or Excel (.xlsx) file.");
        return;
      }
      void parse(file);
    },
    [parse]
  );

  // Dropzone runs these event handlers before its asynchronous extraction.
  // Record only real selections; drag-enter also extracts data for hover feedback.
  const stampSelection = (event: DropEvent) => {
    if (active.current) selectionVersions.current.set(event, ++parseVersion.current);
  };

  const getFilesFromEvent = useCallback(async (event: DropEvent) => {
    try {
      return await fromEvent(event);
    } catch (error) {
      if (active.current && selectionVersions.current.get(event) === parseVersion.current) {
        setPending(null);
        setSheetError(null);
        setIsUploading(false);
        setError("Unable to read this file. Choose it again or try another file.");
      }
      // Let dropzone stop processing this event without publishing an empty drop.
      throw error;
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    getFilesFromEvent,
    onError: () => { /* Extraction failures are handled above with the originating event. */ },
    accept: {
      "text/csv": [".csv"],
      "application/vnd.ms-excel": [".csv"],
      [XLSX_MIME]: [".xlsx"],
    },
    maxFiles: 1,
  });

  return (
    <div className="flex flex-col items-center justify-center p-12 text-center min-h-[500px]">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-2">
          Upload your transactions file
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Export transaction history from your bank or another app as CSV or
          Excel (.xlsx) and upload it here. We'll help you map the columns next.
        </p>
      </div>

      {pending ? (
        <SheetPicker data={pending.data} isLoading={isUploading} error={sheetError}
          onSheetChange={(sheet) => void parse(pending.file, sheet)}
          onContinue={() => proceed(pending.file, pending.data)} />
      ) : (
      <div
        {...getRootProps({
          onDrop: (event: React.DragEvent<HTMLElement>) => {
            if (Array.from(event.dataTransfer.types).some(type => type === "Files" || type === "application/x-moz-file")) {
              stampSelection(event);
            }
          },
        })}
        className={`w-full max-w-xl p-12 border-2 border-dashed rounded-lg transition-colors cursor-pointer flex flex-col items-center gap-4
          ${
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50"
          }
          ${error ? "border-destructive/50 bg-destructive/5" : ""}
        `}
      >
        <input {...getInputProps({
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            if (event.target.files?.length) stampSelection(event);
          },
        })} />

        {isUploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-12 w-12 text-primary animate-spin" />
            <p className="text-sm font-medium">Parsing file...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2" role="alert">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="text-destructive font-medium">{error}</p>
            <p className="text-sm text-muted-foreground">
              Click or drag to try again
            </p>
          </div>
        ) : (
          <>
            <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-2">
              <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-medium">
                {isDragActive
                  ? "Drop the file here"
                  : "Upload your transactions file"}
              </p>
              <p className="text-xs text-muted-foreground">
                Supported formats: CSV, Excel (.xlsx)
              </p>
            </div>
          </>
        )}
      </div>
      )}

      {/* Manual Trigger Button just in case */}
      {!isUploading && !pending && (
        <div className="mt-8">
          <Button
            variant="default"
            className="w-[200px]"
            onClick={(e) => e.preventDefault()}
          >
            Select File
          </Button>
          {/* Note: The dropzone covers this usually, but visual affordance helps */}
        </div>
      )}

      <TemplateDownloads />
    </div>
  );
}
