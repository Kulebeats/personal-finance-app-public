/**
 * Receipt matching (OPS-003): matches pending receipts to transactions posted
 * since their last attempt, with the retry backoff in receipt/matching.ts.
 *
 * It runs as the scheduled job receipts.match (core/scheduling/jobCatalog.ts),
 * under its own advisory lock and the job journal like every other scheduled
 * job, so two instances never match the same queue at once and readiness sees
 * when it last succeeded. A receipt whose attempt throws counts as failed, and
 * the run is journaled as a partial failure.
 */
import { receiptService } from "../services/ReceiptService";
import type { JobSummary } from "../core/scheduling/jobJournal";

export async function runReceiptMatching(): Promise<JobSummary> {
  return receiptService.processMatchingQueue();
}
