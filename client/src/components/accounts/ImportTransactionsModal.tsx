/**
 * ImportTransactionsModal Component
 *
 * Modal for importing transactions from a CSV file for a single account.
 * CSV Format: Date, Merchant, Category, Account, Original Statement, Notes, Amount, Tags
 */

import { useState, useCallback, useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Upload, FileText, AlertCircle, Loader2, X } from "lucide-react";
import { useImportTransactions } from "@/hooks";
import { cn } from "@/lib/utils";
import { parseTransactionCsv } from "./parseTransactionCsv";
import { DateFormatSelect } from "../import/DateFormatSelect";
import { ImportDatePreview } from "../import/ImportDatePreview";
import type { ImportDateFormat } from "@shared/import-date";
import { IMPORT_REVIEW_REQUIRED, type ApiError, type TransactionImportReviewItem } from "@/lib/api";
import { ImportDuplicateDecisions, importDecisions } from "./ImportDuplicateDecisions";

interface ImportTransactionsModalProps {
  accountId: string;
  accountName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportTransactionsModal({
  accountId,
  accountName,
  open,
  onOpenChange,
}: ImportTransactionsModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [adjustBalance, setAdjustBalance] = useState(false);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [dateFormat, setDateFormat] = useState<ImportDateFormat>("auto");
  const readVersion = useRef(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // A-01: rows the server held back as possible duplicates, and the ones the member skips.
  const [review, setReview] = useState<TransactionImportReviewItem[] | null>(null);
  const [skipRows, setSkipRows] = useState<number[]>([]);

  const importTransactions = useImportTransactions();
  const parsed = useMemo(() => {
    if (sourceText === null) return { rows: [], error: null };
    try { return { rows: parseTransactionCsv(sourceText, dateFormat), error: null }; }
    catch (error) { return { rows: [], error: error instanceof Error ? error.message : "Failed to parse CSV" }; }
  }, [sourceText, dateFormat]);
  const parsedData = parsed.rows;
  const clearReview = () => { setReview(null); setSkipRows([]); };
  const displayedError = parseError ?? parsed.error;

  const handleFileSelect = useCallback(
    (selectedFile: File) => {
      setFile(selectedFile);
      setParseError(null);
      clearReview();
      setSourceText(null);
      const version = ++readVersion.current;

      const reader = new FileReader();
      reader.onload = (e) => {
        if (version !== readVersion.current) return;
        setSourceText(String(e.target?.result ?? ""));
      };
      reader.onerror = () => {
        if (version !== readVersion.current) return;
        setParseError("Failed to read file");
      };
      reader.readAsText(selectedFile);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile && droppedFile.type === "text/csv") {
        handleFileSelect(droppedFile);
      } else {
        setParseError("Please upload a CSV file");
      }
    },
    [handleFileSelect]
  );

  const handleImport = async () => {
    if (parsedData.length === 0 || displayedError) return;

    try {
      await importTransactions.mutateAsync({
        id: accountId,
        transactions: parsedData,
        adjustBalance,
        decisions: review ? importDecisions(review, skipRows) : [],
      });
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.code !== IMPORT_REVIEW_REQUIRED) return;
      // The fresh list replaces any earlier one; every row starts skipped (A-01).
      const items = (apiError.details as { possibleDuplicates?: TransactionImportReviewItem[] } | undefined)?.possibleDuplicates ?? [];
      setReview(items);
      setSkipRows(items.map(item => item.row));
      return;
    }

    // Reset and close
    setFile(null);
    setSourceText(null);
    setDateFormat("auto");
    ++readVersion.current;
    setAdjustBalance(false);
    clearReview();
    onOpenChange(false);
  };

  const handleClose = () => {
    clearReview();
    setFile(null);
    setSourceText(null);
    setDateFormat("auto");
    ++readVersion.current;
    setParseError(null);
    setAdjustBalance(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import Transactions</DialogTitle>
          <DialogDescription>
            Import transactions from a CSV file to {accountName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <DateFormatSelect value={dateFormat} onChange={format => { setDateFormat(format); clearReview(); }} />
          {/* File Upload Zone */}
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50",
              file && parsedData.length > 0 && !displayedError && "border-emerald-500 bg-emerald-50"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="space-y-2">
                <FileText className="w-10 h-10 mx-auto text-emerald-600" />
                <p className="font-medium text-foreground">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {parsedData.length} transactions found
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFile(null);
                    setSourceText(null);
                    ++readVersion.current;
                    setParseError(null);
                  }}
                >
                  <X className="w-4 h-4 mr-1" />
                  Remove
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="w-10 h-10 mx-auto text-muted-foreground" />
                <p className="font-medium text-foreground">Upload a CSV File</p>
                <p className="text-sm text-muted-foreground">
                  Drag and drop or click to browse
                </p>
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  id="csv-upload"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById("csv-upload")?.click()}
                >
                  Browse Files
                </Button>
              </div>
            )}
          </div>

          {/* Parse Error */}
          {displayedError && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-md">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-rose-800">Error parsing file</p>
                <p className="text-sm text-rose-700">{displayedError}</p>
              </div>
            </div>
          )}
          {review && review.length > 0 && (
            <ImportDuplicateDecisions items={review} rows={parsedData} skipRows={skipRows} onSkipRowsChange={setSkipRows} />
          )}
          {parsedData.length > 0 && <ImportDatePreview dates={parsedData.map((row, index) => ({
            rowIndex: index + 2, dateString: row.date,
          }))} />}

          {/* Adjust Balance Toggle */}
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
            <div className="space-y-0.5">
              <Label htmlFor="adjust-balance" className="font-medium">
                Adjust account's balance
              </Label>
              <p className="text-xs text-muted-foreground">
                Update the account balance based on imported transaction amounts
              </p>
            </div>
            <Switch
              id="adjust-balance"
              checked={adjustBalance}
              onCheckedChange={setAdjustBalance}
            />
          </div>

          {/* CSV Format Info */}
          <div className="p-3 bg-muted/30 rounded-md">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Required CSV format (8 columns):
            </p>
            <p className="text-xs text-muted-foreground">
              Date, Merchant, Category, Account, Original Statement, Notes, Amount, Tags
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Use negative amounts (-58.12) for expenses, positive for income
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={parsedData.length === 0 || importTransactions.isPending}
            className="bg-orange-500 hover:bg-orange-600"
          >
            {importTransactions.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : review ? (
              `Import with these choices`
            ) : (
              `Add ${parsedData.length} transactions`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
