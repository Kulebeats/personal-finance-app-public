/**
 * Receipt Matching Background Job
 * Runs periodically to match pending receipts to newly posted transactions
 */

import { receiptService } from "../services/ReceiptService";
import { logger } from "../utils/logger";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let isRunning = false;
let intervalId: NodeJS.Timeout | null = null;

/**
 * Start the receipt matching background job
 */
export function startReceiptMatchingJob(): void {
  logger.info("Starting receipt matching background job");

  // Run immediately on startup
  runMatchingCycle();

  // Schedule periodic runs
  intervalId = setInterval(runMatchingCycle, INTERVAL_MS);
}

/**
 * Stop the receipt matching background job
 */
export function stopReceiptMatchingJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("Receipt matching background job stopped");
  }
}

/**
 * Run a single matching cycle
 */
async function runMatchingCycle(): Promise<void> {
  if (isRunning) {
    logger.debug("Receipt matching: Previous cycle still running, skipping");
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    const result = await receiptService.processMatchingQueue();
    const duration = Date.now() - startTime;

    if (result.processed > 0) {
      logger.info("Receipt matching cycle completed", {
        job: "receipt-matcher",
        processed: result.processed,
        matched: result.matched,
        duration,
      });
    }
  } catch (err) {
    logger.error("Receipt matching cycle error", {}, err as Error);
  } finally {
    isRunning = false;
  }
}
