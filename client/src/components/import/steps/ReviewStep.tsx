import { useImportWizard } from "../ImportWizardContext";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Account, ApiResponse } from "@/lib/api";
import { previewImportDates } from "../datePreview";
import { ImportDatePreview } from "../ImportDatePreview";
import { ImportDuplicateReview } from "../ImportDuplicateReview";
import { useImportPreview } from "../useImportPreview";

export function ReviewStep() {
  const {
    parsedData,
    importStrategy,
    setStrategy,
    setStep,
    targetAccountId,
    setTargetAccountId,
    mapping,
    dateFormat,
  } = useImportWizard();
  const preview = previewImportDates(parsedData?.rows ?? [], mapping.date, dateFormat);
  const serverPreview = useImportPreview();
  // Import only after the duplicate check has run, so candidate choices are explicit.
  const isPreviewBlocked = !serverPreview.data || (serverPreview.data.counts.conflict ?? 0) > 0;

  // Fetch accounts. GET /api/accounts returns the V7 envelope
  // { success: true, data: Account[] } — data IS the bare accounts array.
  const { data: accountsResponse } = useQuery<ApiResponse<Account[]>>({
    queryKey: ["/api/accounts"],
  });
  const accounts = accountsResponse?.data ?? [];

  const handleNext = () => {
    if (preview.hasErrors || !preview.rows.length || isPreviewBlocked) return;
    if (!targetAccountId) {
      alert("Please select a target account");
      return;
    }
    setStep("progress");
  };

  const totalRows = parsedData?.rows.length || 0;

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 border-b">
        <h2 className="text-xl font-semibold">Review and Import</h2>
        <p className="text-muted-foreground text-sm">
          You are about to import {totalRows} transactions. Choose how to handle
          duplicates.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <p className="text-sm">CSV date format: {dateFormat === "auto" ? "Auto (unambiguous dates only)" : dateFormat}.
          Calendar dates; no timezone conversion.</p>
        <ImportDatePreview dates={preview.dates} />
        {/* Account Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Target Account *</Label>
          <Select
            value={targetAccountId || ""}
            onValueChange={setTargetAccountId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select an account..." />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((acc) => (
                <SelectItem key={acc.id} value={acc.id}>
                  {acc.name} ({acc.type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Transactions will be imported to this account.
          </p>
        </div>

        <RadioGroup
          value={importStrategy}
          onValueChange={(val) => setStrategy(val as "prioritize_coppercoin" | "prioritize_csv")}
          className="space-y-4"
        >
          <div
            className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
              importStrategy === "prioritize_coppercoin"
                ? "border-primary bg-primary/5"
                : "border-border"
            }`}
          >
            <div className="flex items-start space-x-3">
              <RadioGroupItem
                value="prioritize_coppercoin"
                id="opt-copper"
                className="mt-1"
              />
              <div className="flex-1">
                <Label
                  htmlFor="opt-copper"
                  className="font-semibold text-lg cursor-pointer"
                >
                  Prioritize CopperCoin (Smart Merge)
                </Label>
                <p className="text-muted-foreground mt-1">
                  Safest option. Keeps your existing transactions and only adds
                  new ones from the CSV. Great for filling in gaps without
                  losing manual edits.
                </p>
              </div>
              {importStrategy === "prioritize_coppercoin" && (
                <CheckCircle2 className="text-primary h-6 w-6" />
              )}
            </div>
          </div>

          <div
            className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
              importStrategy === "prioritize_csv"
                ? "border-destructive bg-destructive/5"
                : "border-border"
            }`}
          >
            <div className="flex items-start space-x-3">
              <RadioGroupItem
                value="prioritize_csv"
                id="opt-csv"
                className="mt-1"
              />
              <div className="flex-1">
                <Label
                  htmlFor="opt-csv"
                  className="font-semibold text-lg cursor-pointer text-destructive"
                >
                  Prioritize CSV (Overwrite)
                </Label>
                <p className="text-muted-foreground mt-1">
                  Destructive. Deletes ALL existing transactions in this account
                  within the CSV's date range and replaces them with the CSV
                  data.
                </p>
              </div>
              {importStrategy === "prioritize_csv" && (
                <AlertTriangle className="text-destructive h-6 w-6" />
              )}
            </div>
          </div>
        </RadioGroup>

        {targetAccountId && (
          <ImportDuplicateReview preview={serverPreview.data} isLoading={serverPreview.isLoading}
            error={serverPreview.error} />
        )}

        {importStrategy === "prioritize_csv" && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Warning: Data Loss</AlertTitle>
            <AlertDescription>
              This action cannot be undone. Any manual transactions you added
              for this date range will be permanently deleted.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="p-6 border-t flex justify-end gap-2">
        <Button variant="outline" onClick={() => setStep("category-mapping")}>
          Back
        </Button>
        <Button
          onClick={handleNext}
          disabled={!targetAccountId || preview.hasErrors || !preview.rows.length || isPreviewBlocked}
          variant={
            importStrategy === "prioritize_csv" ? "destructive" : "default"
          }
        >
          {importStrategy === "prioritize_csv"
            ? "Overwrite & Import"
            : "Import Transactions"}
        </Button>
      </div>
    </div>
  );
}
