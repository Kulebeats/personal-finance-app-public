import { and, eq } from "drizzle-orm";
import { householdMembers, transactionCreateOwnerIntents, transactions, type Transaction } from "@shared/schema";
import { db } from "../../db";
import { can, isHouseholdRole } from "../../core/authz/capabilities";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { ConflictError, NotFoundError } from "../../utils/errorHandler";
import { getVisibleRecurringRuleById } from "../recurring/RecurringAudienceQuery";
import { visibleTransferLegs } from "../../repositories/TransferReplay";

/** Replay authorizes the current stored row, never the retried request's references. */
export type HouseholdPostingProducer = "account_import" | "grz_coupon";

export async function readVisibleIdempotentReplay(
  existing: Transaction, householdId: string, userId: string, selectedOwnerId?: string | null,
  producer?: { operation: HouseholdPostingProducer; accountId: string },
  requestDigest?: string,
  requestedPrivate?: boolean,
): Promise<Transaction> {
  const result = await readCreateReplay(existing, householdId, userId, producer?.operation ?? "ordinary", selectedOwnerId, producer?.accountId, requestDigest, requestedPrivate);
  return result.transaction;
}

export async function readRecurringCreateReplay(existing: Transaction, householdId: string, userId: string) {
  const { transaction, recurringRule } = await readCreateReplay(existing, householdId, userId, "recurring");
  if (!recurringRule) throw new ConflictError("Idempotency key does not identify a recurring creation");
  return { transaction, recurringRule, isDuplicate: true };
}

async function readCreateReplay(existing: Transaction, householdId: string, userId: string,
  operation: "ordinary" | "recurring" | HouseholdPostingProducer, selectedOwnerId?: string | null, expectedAccountId?: string, requestDigest?: string, requestedPrivate?: boolean) {
  return db.transaction(async tx => {
    const [membership] = await tx.select({ role: householdMembers.role }).from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId))).limit(1);
    if (!membership || !isHouseholdRole(membership.role) || !can(membership.role, "financial.read")) {
      throw new NotFoundError("Transaction");
    }
    const actor = { householdId, userId, role: membership.role };
    const [transaction] = await tx.select().from(transactions)
      .where(and(eq(transactions.id, existing.id), visibleTransactionPredicate(actor))).limit(1);
    if (!transaction) throw new NotFoundError("Transaction");
    if (transaction.type === "transfer") {
      if (!transaction.transferTransactionId) throw new NotFoundError("Transaction");
      await visibleTransferLegs(tx, actor, transaction.transferTransactionId);
      throw new ConflictError("Idempotency key belongs to a transfer");
    }
    let recurringRule;
    if (transaction.recurringTransactionId) {
      try {
        recurringRule = await getVisibleRecurringRuleById(transaction.recurringTransactionId, actor, tx);
      } catch (error) {
        if (error instanceof NotFoundError) throw new NotFoundError("Transaction");
        throw error;
      }
    }
    const [intent] = await tx.select().from(transactionCreateOwnerIntents)
      .where(eq(transactionCreateOwnerIntents.transactionId, transaction.id));
    const householdOperation = operation === "account_import" || operation === "grz_coupon";
    if (operation === "ordinary" && requestedPrivate !== undefined && !intent?.requestDigest) {
      throw new ConflictError("Original private transaction intent cannot be established for this key");
    }
    if (expectedAccountId && transaction.accountId !== expectedAccountId.toLowerCase()) {
      throw new ConflictError("Idempotency key belongs to a different account");
    }
    if (intent && ((!householdOperation && intent.actorUserId !== userId) || intent.operation !== operation)) {
      throw new ConflictError("Idempotency key belongs to a different actor or operation");
    }
    if (!intent && (operation === "recurring" || operation === "grz_coupon" ||
      (operation === "account_import") !== (transaction.source === "csv_import"))) {
      throw new ConflictError("Original posting operation cannot be established for this key");
    }
    // Before this contract the service ignored owner input. Only omitted-owner
    // replays can retain the previous behavior without inventing evidence.
    if ((intent?.ownerSelected ?? false) !== (selectedOwnerId !== undefined)
      || (intent?.selectedOwnerId ?? null) !== (selectedOwnerId?.toLowerCase() ?? null)) {
      throw new ConflictError("Idempotency key was already used with a different or unproven owner selection");
    }
    if (intent?.requestDigest != null && intent.requestDigest !== requestDigest) {
      throw new ConflictError("Idempotency key was already used with a different transaction request");
    }
    return { transaction, recurringRule };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
