import type { TransactionType } from "../../utils/withTransaction";
import { businessAuditService, type AuditAction } from "../BusinessAuditService";

/**
 * Request context for a recurring rule write's business audit row. The row is
 * written through the write's own transaction, so a failing audit insert rolls
 * the write back instead of letting it commit unlogged (FIN-13, Rule 9).
 */
export interface RecurringAuditRequest {
  ipAddress?: string;
}

interface RecurringAuditActor {
  /** Null keeps a private source off the household's audit trail (as create-with-transaction does). */
  householdId: string | null;
  userId: string;
}

interface RecurringAuditDetails {
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  /** Extra detail fields: the link ids for LINK/UNLINK, `operation` for a create. */
  metadata?: Record<string, unknown>;
}

/**
 * Writes one `recurring_rule` audit row inside `tx`, in the shape the
 * controller wrote after commit before FIN-13: `newValue` for CREATE,
 * `oldValue`/`newValue` (and their changes) for UPDATE, `oldValue` for DELETE,
 * and the link ids for LINK/UNLINK.
 */
export async function auditRecurringRule(
  tx: TransactionType,
  action: Extract<AuditAction, "CREATE" | "UPDATE" | "DELETE" | "LINK" | "UNLINK">,
  ruleId: string,
  actor: RecurringAuditActor,
  audit: RecurringAuditRequest,
  { oldValue, newValue, metadata }: RecurringAuditDetails,
): Promise<void> {
  const row = {
    userId: actor.userId, householdId: actor.householdId, entityType: "recurring_rule" as const, entityId: ruleId,
    ipAddress: audit.ipAddress, tx,
  };
  if (action === "CREATE") return businessAuditService.logCreate({ ...row, newValue, metadata });
  if (action === "UPDATE") return businessAuditService.logUpdate({ ...row, oldValue, newValue, metadata });
  if (action === "DELETE") return businessAuditService.logDelete({ ...row, oldValue, metadata });
  return businessAuditService.log({ ...row, action, details: { ...metadata } });
}
