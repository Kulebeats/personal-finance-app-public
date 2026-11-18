import { ArrowRight, Trash2 } from "lucide-react";

import { Button } from "../ui/button";
import { OcrExtractedData } from "@shared/schema";

type ReceiptFooterProps = {
  activeTab: string;
  receipt?: {
    ocrStatus?: string | null;
    ocrData?: OcrExtractedData | null;
  } | null;
  selectedAccountId: string;
  onDelete: () => void;
  onCreateTransaction: (data: OcrExtractedData) => void;
};

export function ReceiptFooter({
  activeTab,
  receipt,
  selectedAccountId,
  onDelete,
  onCreateTransaction,
}: ReceiptFooterProps) {
  return (
    <div className="p-4 border-t bg-muted/10 flex justify-between items-center">
      <Button
        variant="ghost"
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
        onClick={onDelete}
      >
        <Trash2 className="h-4 w-4 mr-2" />
        Delete Receipt
      </Button>

      {activeTab === "details" && receipt?.ocrStatus === "completed" && (
        <Button
          onClick={() => onCreateTransaction(receipt.ocrData as OcrExtractedData)}
          disabled={!selectedAccountId}
        >
          Create Transaction
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      )}
    </div>
  );
}
