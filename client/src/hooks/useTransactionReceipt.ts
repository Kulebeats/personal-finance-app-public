import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useOcrProcessor } from "./useOcrProcessor";
import { useMatchReceipt, useStoreOcrResults } from "./useReceipts";
import type { OcrExtractedData } from "../lib/receiptParser";

export interface UseTransactionReceiptOptions {
  onAutofill?: (data: OcrExtractedData) => void;
}

export function useTransactionReceipt(
  options: UseTransactionReceiptOptions = {}
) {
  const { onAutofill } = options;

  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [linkedReceiptId, setLinkedReceiptIdState] = useState<string | null>(
    null
  );

  const linkedReceiptIdRef = useRef<string | null>(null);
  const ocrReceiptIdRef = useRef<string | null>(null);

  const storeOcr = useStoreOcrResults();
  const matchReceipt = useMatchReceipt();

  const setLinkedReceiptId = useCallback((next: string | null) => {
    linkedReceiptIdRef.current = next;
    setLinkedReceiptIdState(next);
  }, []);

  const clearReceipt = useCallback(() => {
    ocrReceiptIdRef.current = null;
    setLinkedReceiptId(null);
  }, [setLinkedReceiptId]);

  const handleOcrSuccess = useCallback(
    (data: OcrExtractedData, confidence: number, rawText: string) => {
      const receiptId = ocrReceiptIdRef.current;
      if (!receiptId || receiptId !== linkedReceiptIdRef.current) {
        return;
      }

      storeOcr.mutate(
        {
          receiptId,
          ocrData: data,
          confidence,
          rawText,
        },
        {
          onError: (error: Error) => {
            toast.error(error.message || "Failed to store OCR results");
          },
        }
      );

      onAutofill?.(data);
      toast.success("Receipt scanned and form autofilled!");
    },
    [onAutofill, storeOcr]
  );

  const { processImage, isProcessing: isOcrProcessing } = useOcrProcessor({
    onSuccess: handleOcrSuccess,
    onError: (err) => toast.error(`OCR Failed: ${err}`),
  });

  const handleReceiptUploadSuccess = useCallback(
    (receiptId: string) => {
      setLinkedReceiptId(receiptId);
      ocrReceiptIdRef.current = receiptId;
      processImage(`/api/receipts/${receiptId}/ocr-image`);
    },
    [processImage, setLinkedReceiptId]
  );

  const linkReceiptToTransaction = useCallback(
    async (transactionId: string) => {
      const receiptId = linkedReceiptIdRef.current;
      if (!receiptId) return;

      try {
        await matchReceipt.mutateAsync({ receiptId, transactionId });
      } catch (err) {
        console.error("Failed to match receipt:", err);
        toast.error("Transaction created but failed to link receipt");
      } finally {
        clearReceipt();
      }
    },
    [clearReceipt, matchReceipt]
  );

  return {
    scanModalOpen,
    setScanModalOpen,
    linkedReceiptId,
    isOcrProcessing,
    handleReceiptUploadSuccess,
    linkReceiptToTransaction,
    clearReceipt,
  };
}
