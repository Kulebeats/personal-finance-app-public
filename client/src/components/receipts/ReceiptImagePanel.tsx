import { Loader2, RefreshCw } from "lucide-react";
import { ProtectedImage } from "@/components/session/ProtectedImage";

import { Button } from "../ui/button";

type ReceiptImagePanelProps = {
  receipt: {
    id: string;
    imageUrl: string;
    originalFilename: string;
    size: number;
    ocrData?: {
      merchantName?: string;
      date?: string;
    } | null;
  };
  onRunOcr: () => void;
  isOcrProcessing: boolean;
  ocrStatus?: string | null;
};

export function ReceiptImagePanel({
  receipt,
  onRunOcr,
  isOcrProcessing,
  ocrStatus,
}: ReceiptImagePanelProps) {
  return (
    <div className="w-full md:w-1/2 bg-muted/30 p-4 border-r overflow-hidden flex flex-col">
      <div className="flex-1 relative rounded-lg border bg-background overflow-auto flex items-center justify-center">
        <ProtectedImage
          src={receipt.imageUrl}
          alt={`Receipt image${receipt.ocrData?.merchantName ? ` from ${receipt.ocrData.merchantName}` : ""}${receipt.ocrData?.date ? `, dated ${receipt.ocrData.date}` : ""} - ${receipt.originalFilename}`}
          className="max-w-full max-h-full object-contain"
        />
      </div>
      <div className="mt-4 flex justify-between items-center">
        <p className="text-xs text-muted-foreground">
          Original: {receipt.originalFilename} ({(receipt.size / 1024).toFixed(0)}
          KB)
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={onRunOcr}
          disabled={isOcrProcessing}
        >
          {isOcrProcessing ? (
            <>
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              {ocrStatus || "Scanning..."}
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-3 w-3" />
              Re-scan Receipt
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
