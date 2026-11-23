/**
 * Audit + event for a transaction change made by something other than the
 * ordinary edit path (rule apply, receipt match). FIN-16.
 *
 * Both writes go through the caller's transaction, so a failed audit insert
 * rolls the business change back with it (Rule 9). Private transactions follow
 * the ordinary edit path: the row carries no household id (`privateAudit`).
 *
 * @module services/transaction/updateAudit
 */

import { eq } from "drizzle-orm";
import { accounts, type Transaction } from "@shared/schema";
import { outboxEventService, EventTypes } from "../../core/events";
import { businessAuditService } from "../BusinessAuditService";
import type { TransactionType } from "../../utils/withTransaction";
import { getAuditChanges } from "./helpers";

export interface TransactionUpdateAuditInput {
  householdId: string;
  /** Real actor, or null when the system acted (auto-match). */
  userId: string | null;
  before: Transaction;
  after: Transaction;
  privateAudit: boolean;
  /** Restrict the recorded changes to these fields (those the actor meant to change). */
  onlyFields?: readonly string[];
  /** Extra detail on the row, for example `ruleId` or `receiptId`. */
  metadata?: Record<string, unknown>;
  /** Write the row even when no transaction column changed (tags, goal links, splits). */
  alwaysWrite?: boolean;
  ipAddress?: string;
}

/** Returns the recorded changes, or null when nothing was written. */
export async function auditTransactionUpdate(
  tx: TransactionType,
  input: TransactionUpdateAuditInput,
): Promise<Record<string, { before: unknown; after: unknown }> | null> {
  const all = getAuditChanges(input.before, input.after);
  const changes = Object.fromEntries(
    Object.entries(all).filter(([field]) => !input.onlyFields || input.onlyFields.includes(field)),
  );
  if (Object.keys(changes).length === 0 && !input.alwaysWrite) return null;

  await businessAuditService.log({
    tx,
    householdId: input.privateAudit ? null : input.householdId,
    userId: input.userId,
    action: "UPDATE",
    entityType: "transaction",
    entityId: input.after.id,
    details: { ...input.metadata, changes },
    ipAddress: input.ipAddress,
  });
  await outboxEventService.publish({
    eventType: EventTypes.TRANSACTION_UPDATED,
    aggregateType: "transaction",
    aggregateId: input.after.id,
    householdId: input.householdId,
    payload: { id: input.after.id, changes: Object.keys(changes) },
  }, tx);
  return changes;
}

/**
 * A change to a private transaction, or to any transaction on a private account,
 * is audited without a household id. The ordinary edit snapshot only knows the
 * account's privacy when the edit touches money, so callers combine it with this.
 */
export async function isPrivateTransactionAudit(tx: TransactionType, transaction: Transaction): Promise<boolean> {
  if (transaction.isPrivate) return true;
  const [account] = await tx.select({ isPrivate: accounts.isPrivate }).from(accounts)
    .where(eq(accounts.id, transaction.accountId)).limit(1);
  return account?.isPrivate === true;
}
