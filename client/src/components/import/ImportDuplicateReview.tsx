import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useImportWizard } from "./ImportWizardContext";
import type { ImportPreviewResult, ImportPreviewRow } from "./importApi";

const REASON_LABEL: Record<NonNullable<ImportPreviewRow["candidate"]>["reason"], string> = {
  legacy_import: "imported before from a CSV",
  same_merchant: "same merchant, date and amount",
  same_date_amount: "same date and amount",
};

interface ImportDuplicateReviewProps {
  preview: ImportPreviewResult | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * NEW-17 duplicate review: rows already imported (same identity) are listed as
 * duplicates; rows that only resemble a ledger row are candidates the user
 * decides on. A ticked candidate is skipped; an unticked one is imported.
 */
export function ImportDuplicateReview({ preview, isLoading, error }: ImportDuplicateReviewProps) {
  const { skipRowOrdinals, setSkipRowOrdinals } = useImportWizard();
  if (isLoading) return <p className="text-sm text-muted-foreground" role="status">Checking for duplicates…</p>;
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Duplicate check failed</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }
  if (!preview) return null;

  const candidates = preview.rows.filter(row => row.status === "candidate");
  const removals = preview.removals ?? [];
  const toggle = (ordinal: number, skip: boolean) => setSkipRowOrdinals(skip
    ? [...skipRowOrdinals.filter(value => value !== ordinal), ordinal]
    : skipRowOrdinals.filter(value => value !== ordinal));

  return (
    <section className="space-y-3" aria-labelledby="import-duplicate-review">
      <h3 id="import-duplicate-review" className="text-sm font-medium">Duplicate check</h3>
      <p className="text-sm" data-testid="import-preview-counts">
        {preview.counts.new} new, {preview.counts.duplicate} already imported, {preview.counts.candidate} possible
        {" "}duplicate{preview.counts.candidate === 1 ? "" : "s"}, {preview.counts.failed} with errors.
      </p>
      {preview.counts.conflict > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Some rows match changed history</AlertTitle>
          <AlertDescription>
            {preview.counts.conflict} row(s) conflict: they share a bank reference or file identity with a transaction
            that was edited or deleted, or with another row of this file that differs. The import will be refused
            until that is reconciled.
            {preview.rows.filter(row => row.repeatsOrdinal).map(row => (
              <span key={row.ordinal} className="block">
                Row {row.ordinal} repeats the reference of row {row.repeatsOrdinal} with different content.
              </span>
            ))}
          </AlertDescription>
        </Alert>
      )}
      {removals.length > 0 && (
        <Alert variant="destructive" data-testid="import-overwrite-removals">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            This import removes {removals.length} ledger row{removals.length === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>
            “CSV wins” replaces this date range with the file. These rows are not in the file and will be deleted.
            If any of them changes before you import, the import is refused so you can review again.
            <ul className="mt-2 space-y-1">
              {removals.map(row => (
                <li key={row.id}>
                  {row.date}: {row.name || "Unnamed"} {row.type === "expense" ? "-" : ""}{row.amount.amount} {row.amount.currency}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {candidates.length > 0 && (
        <ul className="space-y-2">
          {candidates.map(row => {
            const id = `import-skip-${row.ordinal}`;
            return (
              <li key={row.ordinal} className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox id={id} checked={skipRowOrdinals.includes(row.ordinal)}
                  onCheckedChange={checked => toggle(row.ordinal, checked === true)} />
                <Label htmlFor={id} className="text-sm font-normal leading-snug">
                  Skip row {row.ordinal}: {row.merchant || "Unnamed"} {row.type === "expense" ? "-" : ""}{row.amount} on {row.date}.
                  {row.candidate && (
                    <span className="block text-muted-foreground">
                      Already in your ledger as “{row.candidate.name}” on {row.candidate.date} ({REASON_LABEL[row.candidate.reason]}).
                    </span>
                  )}
                </Label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
