import { randomUUID } from "node:crypto";
import { withTransaction } from "../../utils/withTransaction";
import { logger } from "../../utils/logger";
import { businessAuditService } from "../BusinessAuditService";

export interface RecurringBatchSummary {
  processed: number;
  created: number;
  errors: number;
  asOfDate: string;
}

/**
 * Writes the run summary row for POST /api/recurring/process and reports
 * whether it was written (FIN-13).
 *
 * The run cannot share one transaction with what it summarises. Each
 * occurrence posts, and writes its own audit row, in its own transaction,
 * so a failure on one rule never rolls back the others. The summary is
 * therefore written after those commits, in a transaction of its own.
 * A failed insert is logged with the run's context and returned as false,
 * so the response can say the summary is missing instead of reporting a
 * clean run. The posted occurrences stay posted.
 */
export async function recordRecurringBatchSummary(
  actor: { householdId: string; userId: string },
  summary: RecurringBatchSummary,
  ipAddress?: string,
): Promise<boolean> {
  try {
    await withTransaction(tx => businessAuditService.log({
      tx, userId: actor.userId, householdId: actor.householdId, action: "PROCESS",
      entityType: "recurring_batch", entityId: randomUUID(), details: { ...summary }, ipAddress,
    }));
    return true;
  } catch (error) {
    logger.error("Recurring batch summary audit row was not written", {
      householdId: actor.householdId, userId: actor.userId, ...summary,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
