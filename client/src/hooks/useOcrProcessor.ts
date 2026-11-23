import { useState, useCallback, useRef, useEffect } from "react";
import { assertOperationLifetime, captureOperationLifetime, StaleOperationError, type OperationLifetime } from "@/lib/operation-lifetime";
import type { Worker } from "tesseract.js";
import { OCR_CORE_PATH, OCR_LANG_PATH, OCR_WORKER_PATH } from "@shared/ocrAssets";
import {
  parseReceiptText,
  calculateConfidence,
  OcrExtractedData,
} from "../lib/receiptParser";

interface UseOcrProcessorOptions {
  onSuccess?: (
    data: OcrExtractedData,
    confidence: number,
    rawText: string
  ) => void;
  onError?: (error: string) => void;
}

interface OcrInvocation {
  operation: OperationLifetime | null;
  isCurrent: () => boolean;
  onSuccess: UseOcrProcessorOptions["onSuccess"];
}

type OcrProgressMessage = {
  status: string;
  progress: number;
};

export function useOcrProcessor(options: UseOcrProcessorOptions = {}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>("");
  const workerRef = useRef<Worker | null>(null);
  const workerOwnerRef = useRef<number | null>(null);
  const workersRef = useRef(new Set<Worker>());
  const requestEpoch = useRef(0);
  // Tracks whether the hook is still mounted so a worker created after
  // unmount is terminated instead of leaked.
  const isMountedRef = useRef(true);

  // Terminate the worker (if it was lazily created) when the hook unmounts.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      requestEpoch.current++;
      workersRef.current.forEach(worker => { void worker.terminate(); });
      workersRef.current.clear();
      workerRef.current = null;
      workerOwnerRef.current = null;
    };
  }, []);

  const cancelProcessing = useCallback(() => {
    requestEpoch.current++;
    workersRef.current.forEach(worker => { void worker.terminate(); });
    workersRef.current.clear();
    workerRef.current = null;
    workerOwnerRef.current = null;
    if (isMountedRef.current) {
      setIsProcessing(false);
      setProgress(0);
      setStatus("");
    }
  }, []);

  // Lazily create the Tesseract worker on first scan. The tesseract.js bundle
  // and its multi-MB language data are only downloaded when OCR actually runs.
  const getWorker = useCallback(async (owner: number): Promise<Worker> => {
    if (workerRef.current && workerOwnerRef.current === null) {
      workerOwnerRef.current = owner;
      return workerRef.current;
    }

    const { createWorker } = await import("tesseract.js");
    let createdWorker: Worker | null = null;
    const worker = await createWorker("eng", 1, {
      // Same-origin copies of the pinned packages (shared/ocrAssets.ts). The
      // defaults are CDN URLs and a blob: worker, all blocked by the
      // production CSP. workerBlobURL: false starts the worker from its own
      // URL, so worker-src needs only 'self'.
      workerPath: OCR_WORKER_PATH,
      corePath: OCR_CORE_PATH,
      langPath: OCR_LANG_PATH,
      workerBlobURL: false,
      logger: (m: OcrProgressMessage) => {
        const activeOwner = createdWorker
          ? workerRef.current === createdWorker ? workerOwnerRef.current : null
          : owner;
        if (!isMountedRef.current || activeOwner === null || requestEpoch.current !== activeOwner) return;
        if (m.status === "recognizing text") {
          setStatus("Reading text...");
          setProgress(Math.round(m.progress * 100));
        } else {
          setStatus(m.status);
        }
      },
    });
    createdWorker = worker;

    if (!isMountedRef.current || requestEpoch.current !== owner) {
      // Hook unmounted while the worker was initializing; clean up and bail.
      await worker.terminate();
      throw new StaleOperationError();
    }

    workerRef.current = worker;
    workerOwnerRef.current = owner;
    workersRef.current.add(worker);
    return worker;
  }, []);

  const processImage = useCallback(
    async (imageUrl: string, invocation?: OcrInvocation) => {
      const operation = invocation ? invocation.operation : captureOperationLifetime();
      const owner = ++requestEpoch.current;
      const isCurrent = () => isMountedRef.current && requestEpoch.current === owner && (!invocation || invocation.isCurrent());
      let ownedWorker: Worker | null = null;
      setIsProcessing(true);
      setProgress(0);
      setStatus("Initializing...");

      try {
        assertOperationLifetime(operation);
        if (!isCurrent()) throw new StaleOperationError();
        ownedWorker = await getWorker(owner);
        assertOperationLifetime(operation);
        if (!isCurrent()) throw new StaleOperationError();
        const result = await ownedWorker.recognize(imageUrl);
        assertOperationLifetime(operation);
        if (!isCurrent()) return;

        setStatus("Parsing data...");
        const rawText = result.data.text;
        const extractedData = parseReceiptText(rawText);
        const confidence = calculateConfidence(extractedData);

        (invocation ? invocation.onSuccess : options.onSuccess)?.(extractedData, confidence, rawText);
      } catch (err) {
        if (!isCurrent() || err instanceof StaleOperationError) return;
        console.error("OCR Check failed:", err);
        options.onError?.(
          err instanceof Error ? err.message : "Failed to process image"
        );
      } finally {
        if (ownedWorker) {
          const current = workerRef.current === ownedWorker && workerOwnerRef.current === owner;
          if (!current || !isCurrent() || operation?.active === false) {
            if (workersRef.current.delete(ownedWorker)) await ownedWorker.terminate();
            if (current) { workerRef.current = null; workerOwnerRef.current = null; }
          } else {
            workerOwnerRef.current = null;
          }
        }
        if (isCurrent() && operation?.active !== false) {
          setIsProcessing(false);
          setProgress(0);
          setStatus("");
        }
      }
    },
    [getWorker, options]
  );

  return {
    processImage,
    cancelProcessing,
    isProcessing,
    progress,
    status,
    isWorkerReady: !!workerRef.current,
  };
}
