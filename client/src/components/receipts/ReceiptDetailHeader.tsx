import { CheckCircle2, FileText } from "lucide-react";

import { Badge } from "../ui/badge";
import { DialogHeader, DialogTitle } from "../ui/dialog";

type ReceiptHeaderData = {
  ocrStatus?: string | null;
  matchStatus?: string | null;
};

type ReceiptDetailHeaderProps = {
  receipt?: ReceiptHeaderData | null;
};

export function ReceiptDetailHeader({ receipt }: ReceiptDetailHeaderProps) {
  return (
    <DialogHeader className="px-6 py-4 border-b">
      <div className="flex items-center justify-between mr-8">
        <DialogTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Receipt Details
        </DialogTitle>
        <div className="flex gap-2">
          {receipt?.ocrStatus === "completed" && (
            <Badge
              variant="secondary"
              className="bg-green-100 text-green-800 hover:bg-green-100"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              OCR Scanned
            </Badge>
          )}
          {receipt?.matchStatus === "matched" && (
            <Badge
              variant="secondary"
              className="bg-blue-100 text-blue-800 hover:bg-blue-100"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Matched
            </Badge>
          )}
        </div>
      </div>
    </DialogHeader>
  );
}
