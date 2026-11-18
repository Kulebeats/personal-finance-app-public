import { format } from "date-fns";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { Badge } from "../ui/badge";

import { Button } from "../ui/button";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ReceiptReviewForm } from "./ReceiptReviewForm";
import { OcrExtractedData } from "@shared/schema";

type ReceiptDetailsTabProps = {
  receipt: {
    ocrStatus?: string | null;
    ocrData?: OcrExtractedData | null;
    ocrConfidence?: number | string | null;
    ocrProcessedAt?: string | Date | null;
  };
  accounts: Array<{ id: string; name: string }>;
  accountsLoading: boolean;
  hasAccounts: boolean;
  selectedAccountId: string;
  onAccountChange: (accountId: string) => void;
  onRunOcr: () => void;
  onCreateTransaction: (data: OcrExtractedData) => void;
  isCreatingTransaction: boolean;
};

export function ReceiptDetailsTab({
  receipt,
  accounts,
  accountsLoading,
  hasAccounts,
  selectedAccountId,
  onAccountChange,
  onRunOcr,
  onCreateTransaction,
  isCreatingTransaction,
}: ReceiptDetailsTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-4">
          Receipt Data
        </h3>
        <div className="mb-5">
          <Label className="text-xs text-muted-foreground">Account</Label>
          <div className="mt-2">
            {accountsLoading ? (
              <div className="text-sm text-muted-foreground">
                Loading accounts...
              </div>
            ) : hasAccounts ? (
              <Select value={selectedAccountId} onValueChange={onAccountChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded-md border border-dashed border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                No accounts available. Add an account first.
              </div>
            )}
          </div>
        </div>
        {receipt.ocrStatus === "pending" || receipt.ocrStatus === "none" || !receipt.ocrData ? (
          <div className="text-center py-10 border-2 border-dashed rounded-lg">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium">No Data Extracted</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              Run OCR scanning to extract merchant, date, and amount information
              from this receipt.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={onRunOcr}>
              Run OCR Scan
            </Button>
          </div>
        ) : (
          <ReceiptReviewForm
            initialData={receipt.ocrData}
            onSubmit={onCreateTransaction}
            isSubmitting={isCreatingTransaction}
          />
        )}
      </div>

      {receipt.ocrData && (() => {
        const confidenceNum = typeof receipt.ocrConfidence === "string"
          ? Number.parseFloat(receipt.ocrConfidence)
          : receipt.ocrConfidence ?? 0;
        const isLowConfidence = confidenceNum < 75;

        return (
          <div
            className={`p-3 rounded text-xs ${
              isLowConfidence
                ? "bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700"
                : "bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              {isLowConfidence && (
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" aria-hidden="true" />
              )}
              <span className={isLowConfidence ? "text-yellow-800 dark:text-yellow-200 font-medium" : "text-muted-foreground"}>
                Confidence: <ConfidenceBadge confidence={confidenceNum} />
              </span>
            </div>
            {isLowConfidence && (
              <p className="text-yellow-700 dark:text-yellow-300 ml-6 mb-2">
                Please review extracted data carefully before saving
              </p>
            )}
            <p className="text-muted-foreground">
              Processed:{" "}
              {receipt.ocrProcessedAt
                ? format(new Date(receipt.ocrProcessedAt), "PP p")
                : ""}
            </p>
          </div>
        );
      })()}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 90) {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-100">
        {confidence}% - High
      </Badge>
    );
  }
  if (confidence >= 75) {
    return (
      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-100">
        {confidence}% - Medium
      </Badge>
    );
  }
  return (
    <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 hover:bg-yellow-100">
      {confidence}% - Low
    </Badge>
  );
}
