import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ParsedData } from "../ImportWizardContext";

interface SheetPickerProps {
  data: ParsedData;
  isLoading: boolean;
  /** The chosen sheet could not be read; another can still be picked. */
  error?: string | null;
  onSheetChange: (sheet: string) => void;
  onContinue: () => void;
}

/** IMP-01: shown when an Excel workbook has several sheets; the first is read by default. */
export function SheetPicker({ data, isLoading, error, onSheetChange, onContinue }: SheetPickerProps) {
  const sheets = data.sheets ?? [];
  const hidden = new Set(data.hiddenSheets ?? []);
  return (
    <div className="w-full max-w-xl space-y-4 text-left" data-testid="import-sheet-picker">
      <div className="space-y-2">
        <Label htmlFor="import-sheet">This workbook has {sheets.length} sheets. Which one holds your transactions?</Label>
        <select id="import-sheet" value={data.sheet} disabled={isLoading}
          onChange={(event) => onSheetChange(event.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {sheets.map((sheet) => <option key={sheet} value={sheet}>{hidden.has(sheet) ? `${sheet} (hidden in Excel)` : sheet}</option>)}
        </select>
        {error && !isLoading ? (
          <p className="text-sm text-destructive" role="alert">{error}</p>
        ) : (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {isLoading ? "Reading sheet..." : `"${data.sheet}": ${data.rows.length} rows below the header row.`}
          </p>
        )}
      </div>
      <Button onClick={onContinue} disabled={isLoading || Boolean(error)}>Continue with this sheet</Button>
    </div>
  );
}
