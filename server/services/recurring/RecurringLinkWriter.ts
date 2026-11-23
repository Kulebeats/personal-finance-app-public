import { eq } from "drizzle-orm";
import { recurringTransactionLinks, type RecurringTransaction, type Transaction } from "@shared/schema";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { ConflictError, ValidationError } from "../../utils/errorHandler";
import type { TransactionType } from "../../utils/withTransaction";
import type { Frequency, IntervalUnit } from "../../core/calculations/recurring/types";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { getVisibleRecurringRuleById } from "./RecurringAudienceQuery";

function alreadyLinkedError() {
  return new ValidationError("Transaction already linked to a recurring rule", [
    { field: "transactionId", message: "Already linked" },
  ]);
}

/** A signed link may complete its own direct pointer, but never reparent a source. */
export async function writeSignedRecurringLink(
  tx: TransactionType, rule: RecurringTransaction, transaction: Transaction, actor: HouseholdContext,
  automaticMatch?: { matchMethod: "auto"; matchConfidence: number },
) {
  // The caller holds the source UPDATE lock, so new FK-backed links cannot
  // appear while its pointer and every existing link are checked together.
  const links = await tx.select({ parentId: recurringTransactionLinks.recurringTransactionId })
    .from(recurringTransactionLinks).where(eq(recurringTransactionLinks.transactionId, transaction.id))
    .orderBy(recurringTransactionLinks.id);
  const parentIds = Array.from(new Set([
    ...links.map(link => link.parentId),
    ...(transaction.recurringTransactionId ? [transaction.recurringTransactionId] : []),
  ])).sort();
  for (const parentId of parentIds) {
    // Different parents are read only to select a safe refusal. No parent lock
    // is acquired after account locks and no mutation follows this branch.
    if (parentId !== rule.id) await getVisibleRecurringRuleById(parentId, actor, tx);
  }
  const differentParent = parentIds.some(parentId => parentId !== rule.id);
  // Preserve the ordinary duplicate-link response once its parent is visible.
  if (differentParent && links.length === 1 && transaction.isRecurring &&
      links[0].parentId === transaction.recurringTransactionId) {
    throw alreadyLinkedError();
  }
  const inconsistentState = links.length
    ? !transaction.isRecurring || transaction.recurringTransactionId !== rule.id
    : transaction.isRecurring && !transaction.recurringTransactionId;
  if (differentParent || inconsistentState) throw new ConflictError("Recurring link state changed");
  return writeRecurringLink(tx, rule, transaction, { matchMethod: "manual", ...automaticMatch, performedBy: actor.userId });
}

/** Shared persistence for signed and trusted linking; callers own authorization and locks. */
export async function writeRecurringLink(
  tx: TransactionType, rule: RecurringTransaction, transaction: Transaction,
  metadata: { matchMethod: "auto" | "manual" | "confirmed"; matchConfidence?: number; performedBy?: string },
) {
  const { matchMethod, matchConfidence, performedBy } = metadata;
  const existingLink = await recurringRepository.findLinkByTransaction(transaction.id, rule.householdId, tx);
  if (existingLink) {
    if (existingLink.recurringTransactionId === rule.id) return existingLink;
    throw alreadyLinkedError();
  }

  const link = await recurringRepository.createLink({
    recurringTransactionId: rule.id, transactionId: transaction.id,
    matchMethod, matchConfidence, expectedDate: rule.nextDueDate, actualDate: transaction.date,
    expectedAmount: rule.amount, actualAmount: transaction.amount, status: "linked",
  }, tx);

  if (!transaction.isRecurring || transaction.recurringTransactionId !== rule.id) {
    await transactionRepository.update(transaction.id, rule.householdId, {
      isRecurring: true, recurringTransactionId: rule.id,
    }, undefined, tx);
  }

  const lastOccurredDate = rule.lastOccurredDate && rule.lastOccurredDate > transaction.date
    ? rule.lastOccurredDate : transaction.date;
  const shouldAdvance = !rule.nextDueDate || transaction.date >= rule.nextDueDate;
  const nextDueDate = shouldAdvance
    ? recurringRepository.calculateNextDate(transaction.date, rule.frequency as Frequency, {
        dayOfMonth: rule.dayOfMonth || undefined,
        dayOfWeek: rule.dayOfWeek ?? undefined,
        intervalValue: rule.intervalValue ?? undefined,
        intervalUnit: (rule.intervalUnit as IntervalUnit | null) ?? undefined,
      })
    : rule.nextDueDate;

  await recurringRepository.update(rule.id, rule.householdId, {
    totalOccurrences: (rule.totalOccurrences || 0) + 1,
    lastOccurredDate, ...(shouldAdvance ? { nextDueDate } : {}),
  }, tx);
  await recurringRepository.logHistory({
    recurringTransactionId: rule.id, action: "linked", newState: { matchMethod, matchConfidence },
    linkedTransactionId: transaction.id, performedBy,
  }, tx);
  return link;
}
