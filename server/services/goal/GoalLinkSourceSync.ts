/**
 * Goal links follow their source transaction (R10.3, FIN-09).
 *
 * When a linked transaction is edited or deleted, each linked goal's progress
 * is refolded from all of its sources (GoalProgressFold), so the stored deltas
 * keep adding up to progress whatever order the edits come in. Both run
 * inside the transaction writer's own database transaction, after it has
 * locked the transaction row and its account, so the lock order is
 * transaction, account, goal (by id), link: the same order as unlink.
 *
 * @module services/goal/GoalLinkSourceSync
 */

import { and, eq, inArray } from "drizzle-orm";
import {
  goalContributions, goals, transactionGoalLinks, type Goal, type Transaction, type TransactionGoalLink,
} from "@shared/schema";
import { Money } from "../../core/money";
import type { TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";
import { goalActivityLogService } from "../GoalActivityLogService";
import { storedLinkDelta, toGoalCurrency } from "./GoalProgressSources";
import { refoldGoalProgress } from "./GoalProgressFold";
import { goalsWithHiddenProgress } from "./GoalViewerProgress";
import type { HouseholdContext } from "../../middleware/householdGuard";

/** Who changed the source; householdId is null when the source is private (as its own audit row). */
export interface SourceChangeAudit {
  userId: string | null;
  householdId: string | null;
  ipAddress?: string;
  /** The member editing over HTTP (refused on hidden progress); system callers omit it. */
  viewer?: HouseholdContext;
}

interface LockedLink {
  goal: Goal;
  link: TransactionGoalLink;
}

async function lockLinkedGoals(tx: TransactionType, transactionId: string): Promise<LockedLink[]> {
  const linked = await tx.select({ goalId: transactionGoalLinks.goalId }).from(transactionGoalLinks)
    .where(eq(transactionGoalLinks.transactionId, transactionId));
  if (linked.length === 0) return [];
  const lockedGoals = await tx.select().from(goals)
    .where(inArray(goals.id, linked.map((row) => row.goalId)))
    .orderBy(goals.id).for("update");
  const lockedLinks = await tx.select().from(transactionGoalLinks)
    .where(eq(transactionGoalLinks.transactionId, transactionId)).for("update");
  return lockedGoals.flatMap((goal) => {
    const link = lockedLinks.find((row) => row.goalId === goal.id);
    return link ? [{ goal, link }] : [];
  });
}

/** The edit changed what a link counts: its amount, its date (and so its rate) or its type. */
export function sourceEconomicsChanged(before: Transaction, after: Transaction): boolean {
  return !new Money(before.amount).equals(new Money(after.amount)) ||
    before.date !== after.date || before.type !== after.type;
}

/** Removes every goal link of a deleted transaction and refolds each goal without it. */
export async function reverseDeletedSourceLinks(
  tx: TransactionType,
  transaction: Transaction,
  audit: SourceChangeAudit,
): Promise<void> {
  const locked = await lockLinkedGoals(tx, transaction.id);
  const hidden = await goalsWithHiddenProgress(audit.viewer, locked.map(({ goal }) => goal.id), tx);
  for (const { goal, link } of locked) {
    const { write, net, rebalanced } = await refoldGoalProgress(tx, goal, {
      from: link.id, removedLinkId: link.id, progressHiddenFromEditor: hidden.has(goal.id),
    });
    await tx.delete(transactionGoalLinks).where(eq(transactionGoalLinks.id, link.id));
    if (link.linkType === "contribution") {
      await tx.delete(goalContributions).where(and(
        eq(goalContributions.goalId, goal.id), eq(goalContributions.transactionId, transaction.id),
      ));
    }
    await goalActivityLogService.log({
      goalId: goal.id, activityType: "transaction_unlinked", amount: net,
      previousBalance: write.previous, newBalance: write.next, createdBy: audit.userId, tx,
      metadata: { transactionId: transaction.id, transactionName: transaction.name, linkType: link.linkType, reason: "source_deleted" },
    });
    await businessAuditService.log({
      tx, userId: audit.userId, householdId: audit.householdId, action: "UNLINK", entityType: "goal", entityId: goal.id,
      details: { operation: "sourceDeleted", transactionId: transaction.id, linkId: link.id, reversedDelta: net.toString(), rebalanced },
      ipAddress: audit.ipAddress,
    });
  }
}

/**
 * Re-applies every goal link of an edited transaction. An edit that leaves the
 * link's goal-currency amount unchanged (a date, notes or type edit at the same
 * rate) only refreshes its provenance and never moves progress; any other edit
 * refolds all of the goal's sources with the new amount.
 */
export async function reapplyEditedSourceLinks(
  tx: TransactionType,
  before: Transaction,
  after: Transaction,
  audit: SourceChangeAudit,
): Promise<void> {
  if (!sourceEconomicsChanged(before, after)) return;
  const locked = await lockLinkedGoals(tx, after.id);
  const hidden = await goalsWithHiddenProgress(audit.viewer, locked.map(({ goal }) => goal.id), tx);
  for (const { goal, link } of locked) {
    const previousDelta = storedLinkDelta(link, goal.currency);
    const sourceCurrency = link.sourceCurrency ?? after.currency ?? goal.currency;
    const source = link.amountBasis === "explicit"
      ? new Money(link.sourceAmount ?? link.amount, sourceCurrency)
      : new Money(after.amount, sourceCurrency).abs();
    const converted = await toGoalCurrency(tx, goal.householdId, source, goal.currency, after.date);
    const amountChanged = !converted.goalAmount.equals(new Money(link.amount, goal.currency));
    const refold = amountChanged
      ? await refoldGoalProgress(tx, goal, {
        from: link.id, editedLink: { id: link.id, amount: converted.goalAmount }, progressHiddenFromEditor: hidden.has(goal.id),
      })
      : null;
    const applied = refold?.effects.get(link.id) ?? previousDelta;

    await tx.update(transactionGoalLinks).set({
      amount: converted.goalAmount.toString(), amountBasis: link.amountBasis ?? "transaction",
      sourceAmount: converted.sourceAmount.toString(), sourceCurrency, fxRate: converted.fxRate,
      appliedDelta: applied.toString(),
    }).where(eq(transactionGoalLinks.id, link.id));
    if (link.linkType === "contribution") {
      await tx.update(goalContributions).set({
        amount: converted.goalAmount.toString(), date: after.date, appliedDelta: applied.toString(),
      }).where(and(eq(goalContributions.goalId, goal.id), eq(goalContributions.transactionId, after.id)));
    }
    if (refold) {
      await goalActivityLogService.log({
        goalId: goal.id, activityType: "balance_synced", amount: refold.net,
        previousBalance: refold.write.previous, newBalance: refold.write.next, createdBy: audit.userId, tx,
        // accountId: a balance_synced row must name the account it came from (goal-activity-visibility).
        metadata: { trigger: "source_edited", transactionId: after.id, accountId: after.accountId, linkType: link.linkType },
      });
    }
    await businessAuditService.log({
      tx, userId: audit.userId, householdId: audit.householdId, action: "UPDATE", entityType: "goal", entityId: goal.id,
      details: { operation: "sourceEdited", transactionId: after.id, linkId: link.id,
        previousDelta: previousDelta.toString(), appliedDelta: applied.toString(),
        progressDelta: (refold?.net ?? Money.zero(goal.currency)).toString(), rebalanced: refold?.rebalanced ?? [] },
      ipAddress: audit.ipAddress,
    });
  }
}
