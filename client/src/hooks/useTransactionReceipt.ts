import { toastActionError } from "@/lib/actionErrorToast";
import { useCallback, useEffect, useRef, useState } from "react";
import { withProtectedBlob, reportProtectedMediaError } from "@/lib/protected-media";
import { assertOperationLifetime, captureOperationLifetime, StaleOperationError, type OperationLifetime } from "@/lib/operation-lifetime";
import { toast } from "sonner";
import { useOcrProcessor } from "./useOcrProcessor";
import { useMatchReceipt, useStoreOcrResults } from "./useReceipts";
import type { OcrExtractedData } from "../lib/receiptParser";

export interface UseTransactionReceiptOptions {
  onAutofill?: (data: OcrExtractedData) => void;
}

interface ReceiptAction {
  readonly receiptId: string;
  readonly operation: OperationLifetime | null;
}

export function useTransactionReceipt(options: UseTransactionReceiptOptions = {}) {
  const { onAutofill } = options;
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [linkedReceiptId, setLinkedReceiptIdState] = useState<string | null>(null);
  const linkedReceiptIdRef = useRef<string | null>(null);
  const actionRef = useRef<ReceiptAction | null>(null);
  const storeOcr = useStoreOcrResults();
  const matchReceipt = useMatchReceipt();
  const { processImage, cancelProcessing, isProcessing: isOcrProcessing } = useOcrProcessor({
    onError: error => toast.error(`OCR Failed: ${error}`),
  });

  useEffect(() => () => { actionRef.current = null; linkedReceiptIdRef.current = null; }, []);

  const selectReceipt = useCallback((next: string | null) => {
    // Retire receipt purpose before any Blob prefetch or worker preparation.
    actionRef.current = null;
    cancelProcessing();
    linkedReceiptIdRef.current = next;
    setLinkedReceiptIdState(next);
  }, [cancelProcessing]);

  const clearReceipt = useCallback(() => selectReceipt(null), [selectReceipt]);
  const assertReceiptAction = useCallback((action: ReceiptAction) => {
    assertOperationLifetime(action.operation);
    if (actionRef.current !== action || linkedReceiptIdRef.current !== action.receiptId) throw new StaleOperationError();
  }, []);

  const handleOcrSuccess = useCallback((action: ReceiptAction, data: OcrExtractedData, confidence: number, rawText: string) => {
    assertReceiptAction(action);
    storeOcr.mutate({ receiptId: action.receiptId, ocrData: data, confidence, rawText }, {
      onError: error => {
        if (actionRef.current === action) toastActionError("Failed to store OCR results", error);
      },
    });
    onAutofill?.(data);
    toast.success("Receipt scanned and form autofilled!");
  }, [assertReceiptAction, onAutofill, storeOcr]);

  const handleReceiptUploadSuccess = useCallback((receiptId: string) => {
    selectReceipt(receiptId);
    const action: ReceiptAction = { receiptId, operation: captureOperationLifetime() };
    actionRef.current = action;
    void withProtectedBlob(`/api/receipts/${receiptId}/ocr-image`, async objectUrl => {
      assertReceiptAction(action);
      await processImage(objectUrl, {
        operation: action.operation,
        isCurrent: () => actionRef.current === action && linkedReceiptIdRef.current === action.receiptId,
        onSuccess: (data, confidence, rawText) => handleOcrSuccess(action, data, confidence, rawText),
      });
    }, action.operation).catch(reportProtectedMediaError);
  }, [assertReceiptAction, handleOcrSuccess, processImage, selectReceipt]);

  const linkReceiptToTransaction = useCallback(async (transactionId: string) => {
    const receiptId = linkedReceiptIdRef.current;
    const action = actionRef.current;
    if (!receiptId) return;
    try {
      await matchReceipt.mutateAsync({ receiptId, transactionId });
    } catch (error) {
      if (actionRef.current === action && linkedReceiptIdRef.current === receiptId) {
        console.error("Failed to match receipt:", error);
        toast.error("Transaction created but failed to link receipt");
      }
    } finally {
      if (actionRef.current === action && linkedReceiptIdRef.current === receiptId) clearReceipt();
    }
  }, [clearReceipt, matchReceipt]);

  const captureReceiptLink = useCallback(() => {
    const receiptId = linkedReceiptIdRef.current, action = actionRef.current, operation = captureOperationLifetime();
    if (!receiptId) return undefined;
    return async (transactionId: string) => {
      assertOperationLifetime(operation);
      await matchReceipt.mutateAsync({ receiptId, transactionId });
      assertOperationLifetime(operation);
      if (actionRef.current === action && linkedReceiptIdRef.current === receiptId) clearReceipt();
    };
  }, [clearReceipt, matchReceipt]);

  return { scanModalOpen, setScanModalOpen, linkedReceiptId, isOcrProcessing, handleReceiptUploadSuccess, linkReceiptToTransaction, captureReceiptLink, clearReceipt };
}
