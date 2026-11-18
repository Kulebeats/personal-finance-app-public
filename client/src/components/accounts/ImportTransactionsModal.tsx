/**
 * ImportTransactionsModal Component
 *
 * Modal for importing transactions from a CSV file for a single account.
 * CSV Format: Date, Merchant, Category, Account, Original Statement, Notes, Amount, Tags
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Upload, FileText, AlertCircle, Loader2, X } from "lucide-react";
import { useImportTransactions } from "@/hooks";
import { isParsableMoneyString } from "@/lib/money";
import { cn } from "@/lib/utils";

interface ImportTransactionsModalProps {
  accountId: string;
  accountName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedTransaction {
  date: string;
  merchant: string;
  category?: string;
  originalStatement?: string;
  notes?: string;
  amount: string;
  tags?: string;
}

export function ImportTransactionsModal({
  accountId,
  accountName,
  open,
  onOpenChange,
}: ImportTransactionsModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [adjustBalance, setAdjustBalance] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedTransaction[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const importTransactions = useImportTransactions();

  const parseCSV = useCallback((text: string): ParsedTransaction[] => {
    const lines = text.trim().split("\n");
    if (lines.length < 2) {
      throw new Error("CSV file must contain a header row and at least one data row");
    }

    // Skip header row
    const dataLines = lines.slice(1);
    const transactions: ParsedTransaction[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i].trim();
      if (!line) continue;

      // Parse CSV line (handling quoted fields)
      const fields: string[] = [];
      let field = "";
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          fields.push(field.trim());
          field = "";
        } else {
          field += char;
        }
      }
      fields.push(field.trim());

      // Validate required fields
      if (fields.length < 7) {
        throw new Error(`Row ${i + 2}: Expected at least 7 columns, got ${fields.length}`);
      }

      const [date, merchant, category, , originalStatement, notes, amount, tags] = fields;

      if (!date || !merchant || !amount) {
        throw new Error(`Row ${i + 2}: Date, Merchant, and Amount are required`);
      }

      // Normalize thousands separators (the CSV contract uses "." as the
      // decimal point), then strict-parse. This imports "1,234.56" correctly
      // as 1234.56 instead of the old parseFloat("1,234.56") === 1 silent
      // corruption, while still rejecting genuine garbage like "12abc".
      const normalizedAmount = amount.replace(/,/g, "").trim();
      if (!isParsableMoneyString(normalizedAmount)) {
        throw new Error(`Row ${i + 2}: Invalid amount "${amount}"`);
      }

      transactions.push({
        date,
        merchant,
        category: category || undefined,
        originalStatement: originalStatement || undefined,
        notes: notes || undefined,
        amount: normalizedAmount,
        tags: tags || undefined,
      });
    }

    return transactions;
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

    await importTransactions.mutateAsync({
      id: accountId,
      transactions: parsedData,
      adjustBalance,
    });

    // Reset and close
    setFile(null);
    setParsedData([]);
    setAdjustBalance(false);
    onOpenChange(false);
  };

  const handleClose = () => {
    setFile(null);
    setParsedData([]);
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
                  {parsedData.length} transactions found
                </p>
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
          {parseError && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-md">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-rose-800">Error parsing file</p>
                <p className="text-sm text-rose-700">{parseError}</p>
              </div>
            </div>
          )}

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
            ) : (
              `Add ${parsedData.length} transactions`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
