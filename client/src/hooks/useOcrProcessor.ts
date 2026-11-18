import { useState, useCallback, useRef, useEffect } from "react";
import type { Worker } from "tesseract.js";
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

type OcrProgressMessage = {
  status: string;
  progress: number;
};

export function useOcrProcessor(options: UseOcrProcessorOptions = {}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>("");
  const workerRef = useRef<Worker | null>(null);
  // Tracks whether the hook is still mounted so a worker created after
  // unmount is terminated instead of leaked.
  const isMountedRef = useRef(true);

  // Terminate the worker (if it was lazily created) when the hook unmounts.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  // Lazily create the Tesseract worker on first scan. The tesseract.js bundle
  // and its multi-MB language data are only downloaded when OCR actually runs.
  const getWorker = useCallback(async (): Promise<Worker> => {
    if (workerRef.current) {
      return workerRef.current;
    }

    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      logger: (m: OcrProgressMessage) => {
        if (!isMountedRef.current) return;
        if (m.status === "recognizing text") {
          setStatus("Reading text...");
          setProgress(Math.round(m.progress * 100));
        } else {
          setStatus(m.status);
        }
      },
    });

    if (!isMountedRef.current) {
      // Hook unmounted while the worker was initializing; clean up and bail.
      await worker.terminate();
      throw new Error("OCR worker initialization aborted");
    }

    workerRef.current = worker;
    return worker;
  }, []);

  const processImage = useCallback(
    async (imageUrl: string) => {
      setIsProcessing(true);
      setProgress(0);
      setStatus("Initializing...");

      try {
        const worker = await getWorker();
        const result = await worker.recognize(imageUrl);

        setStatus("Parsing data...");
        const rawText = result.data.text;
        const extractedData = parseReceiptText(rawText);
        const confidence = calculateConfidence(extractedData);

        options.onSuccess?.(extractedData, confidence, rawText);
      } catch (err) {
        console.error("OCR Check failed:", err);
        options.onError?.(
          err instanceof Error ? err.message : "Failed to process image"
        );
      } finally {
        setIsProcessing(false);
        setProgress(0);
        setStatus("");
      }
    },
    [getWorker, options]
  );

  return {
    processImage,
    isProcessing,
    progress,
    status,
    isWorkerReady: !!workerRef.current,
  };
}
