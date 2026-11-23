/**
 * A-01: rows an Account Detail import will not post until the member decides,
 * because each may repeat a transaction already on the account (one imported
 * through the import wizard, say). A ticked row is skipped; an unticked one is
 * posted. Every row starts ticked, so nothing posts twice by default.
 */
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { TransactionImportDecision, TransactionImportReviewItem, TransactionImportRow } from "@/lib/api";

interface ImportDuplicateDecisionsProps {
  items: TransactionImportReviewItem[];
  rows: TransactionImportRow[];
  skipRows: number[];
  onSkipRowsChange: (rows: number[]) => void;
}

/** The decisions to send: one per reviewed row, bound to the transaction it was shown against. */
export function importDecisions(items: TransactionImportReviewItem[], skipRows: number[]): TransactionImportDecision[] {
  return items.map(item => ({ row: item.row, matchesTransactionId: item.matchesTransactionId,
    decision: skipRows.includes(item.row) ? "skip" : "post" }));
}

export function ImportDuplicateDecisions({ items, rows, skipRows, onSkipRowsChange }: ImportDuplicateDecisionsProps) {
  const toggle = (row: number, skip: boolean) =>
    onSkipRowsChange(skip ? [...skipRows.filter(value => value !== row), row] : skipRows.filter(value => value !== row));
  return (
    <Alert data-testid="account-import-review">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {items.length} row{items.length === 1 ? "" : "s"} may already be on this account
      </AlertTitle>
      <AlertDescription>
        <p>Nothing has been imported yet. Ticked rows are skipped; untick a row to add it anyway.</p>
        <ul className="mt-2 space-y-2">
          {items.map(item => {
            const id = `account-import-skip-${item.row}`;
            const source = rows[item.row - 1];
            const sign = item.match.type === "expense" ? "-" : "";
            return (
              <li key={item.row} className="flex items-start gap-3">
                <Checkbox id={id} checked={skipRows.includes(item.row)}
                  onCheckedChange={checked => toggle(item.row, checked === true)} />
                <Label htmlFor={id} className="text-sm font-normal leading-snug">
                  Skip row {item.row}: {source?.merchant ?? "Unnamed"} {source?.amount} on {source?.date}.
                  <span className="block text-muted-foreground">
                    Already on this account as “{item.match.name}” on {item.match.date} ({sign}{item.match.amount.amount} {item.match.amount.currency}).
                  </span>
                </Label>
              </li>
            );
          })}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
