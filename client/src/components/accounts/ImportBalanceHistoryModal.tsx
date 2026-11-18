/**
 * ImportBalanceHistoryModal Component
 *
 * Modal for importing balance history from a CSV file for a single account.
 * CSV Format: Date (YYYY-MM-DD), Amount
 */

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileText, AlertCircle, Loader2, X } from "lucide-react";
import { useImportBalanceHistory } from "@/hooks";
import { parseMoneyInputNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

interface ImportBalanceHistoryModalProps {
  accountId: string;
  accountName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedBalanceEntry {
  date: string;
  amount: string;
}

export function ImportBalanceHistoryModal({
  accountId,
  accountName,
  open,
  onOpenChange,
}: ImportBalanceHistoryModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedBalanceEntry[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const importBalanceHistory = useImportBalanceHistory();

  const parseCSV = useCallback((text: string): ParsedBalanceEntry[] => {
    const lines = text.trim().split("\n");
    if (lines.length < 2) {
      throw new Error("CSV file must contain a header row and at least one data row");
    }

    // Skip header row
    const dataLines = lines.slice(1);
    const entries: ParsedBalanceEntry[] = [];
    const seenDates = new Set<string>();

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i].trim();
      if (!line) continue;

      // Parse CSV line
      const fields = line.split(",").map((f) => f.trim().replace(/^"|"$/g, ""));

      if (fields.length < 2) {
        throw new Error(`Row ${i + 2}: Expected at least 2 columns (Date, Amount)`);
      }

      const [date, amount] = fields;

      // Validate date format (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`Row ${i + 2}: Invalid date format "${date}". Use YYYY-MM-DD`);
      }

      // Check for future dates
      const entryDate = new Date(date);
      if (entryDate > new Date()) {
        throw new Error(`Row ${i + 2}: Future dates are not supported ("${date}")`);
      }

      // Check for duplicate dates
      if (seenDates.has(date)) {
        throw new Error(`Row ${i + 2}: Duplicate date "${date}". Each date must be unique`);
      }
      seenDates.add(date);

      const parsedAmount = parseMoneyInputNumber(amount);
      if (parsedAmount === null) {
        throw new Error(`Row ${i + 2}: Invalid amount format "${amount}"`);
      }

      entries.push({ date, amount: parsedAmount.toFixed(2) });
    }

    // Sort by date (oldest first)
    entries.sort((a, b) => a.date.localeCompare(b.date));

    return entries;
  }, []);

  const handleFileSelect = useCallback(
    (selectedFile: File) => {
      setFile(selectedFile);
      setParseError(null);
      setParsedData([]);

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const data = parseCSV(text);
          setParsedData(data);
        } catch (error) {
          setParseError(error instanceof Error ? error.message : "Failed to parse CSV");
        }
      };
      reader.onerror = () => {
        setParseError("Failed to read file");
      };
      reader.readAsText(selectedFile);
    },
    [parseCSV]
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
    if (parsedData.length === 0) return;

    await importBalanceHistory.mutateAsync({
      id: accountId,
      data: parsedData,
    });

    // Reset and close
    setFile(null);
    setParsedData([]);
    onOpenChange(false);
  };

  const handleClose = () => {
    setFile(null);
    setParsedData([]);
    setParseError(null);
    onOpenChange(false);
  };

  // Get date range preview
  const dateRangePreview = parsedData.length > 0
    ? `${parsedData[0].date} to ${parsedData[parsedData.length - 1].date}`
    : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Import Balance History</DialogTitle>
          <DialogDescription>
            Import historical balance data for {accountName}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Upload Zone */}
          <div
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50",
              file && !parseError && "border-emerald-500 bg-emerald-50"
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
                  {parsedData.length} balance entries found
                </p>
                {dateRangePreview && (
                  <p className="text-xs text-muted-foreground">
                    Date range: {dateRangePreview}
                  </p>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFile(null);
                    setParsedData([]);
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
                  id="balance-csv-upload"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById("balance-csv-upload")?.click()}
                >
                  Browse Files
                </Button>
              </div>
            )}
          </div>

          {/* Parse Error */}
          {parseError && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-md">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-rose-800">Error parsing file</p>
                <p className="text-sm text-rose-700">{parseError}</p>
              </div>
            </div>
          )}

          {/* Preview Table */}
          {parsedData.length > 0 && (
            <div className="border rounded-md overflow-hidden max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {parsedData.slice(0, 10).map((entry, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">{entry.date}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {parseMoneyInputNumber(entry.amount)?.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }) ?? entry.amount}
                      </td>
                    </tr>
                  ))}
                  {parsedData.length > 10 && (
                    <tr>
                      <td colSpan={2} className="px-3 py-2 text-center text-muted-foreground">
                        ... and {parsedData.length - 10} more entries
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* CSV Format Info */}
          <div className="p-3 bg-muted/30 rounded-md">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              Required CSV format (2 columns):
            </p>
            <p className="text-xs text-muted-foreground">
              Date (YYYY-MM-DD), Amount
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Use negative amounts (-500.00) for liability accounts
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={parsedData.length === 0 || importBalanceHistory.isPending}
            className="bg-orange-500 hover:bg-orange-600"
          >
            {importBalanceHistory.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              `Add ${parsedData.length} entries`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
