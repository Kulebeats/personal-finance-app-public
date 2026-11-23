import { and, eq, isNull, or } from "drizzle-orm";
import {
  accounts,
  goalContributions,
  goals,
  transactionGoalLinks,
  transactions,
  type Goal,
} from "@shared/schema";
import { Money } from "../../core/money";
import { goalRepository } from "../../repositories/GoalRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import { householdToday } from "../householdCalendarToday";
import { lockAccountHousehold } from "../../repositories/AccountCreationGrant";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { calculatePercentComplete } from "../goalCalculations";
import { goalActivityLogService } from "../GoalActivityLogService";
import { businessAuditService } from "../BusinessAuditService";
import { notificationService } from "../NotificationService";
import { GoalMutationService } from "./GoalMutationService";
import { HIDDEN_GOAL_WRITE_REFUSAL, assertWithinTarget, notifyGoalMilestone } from "./GoalProgressSources";
import { PENDING_EFFECT, refoldGoalProgress, sourceTimeSql } from "./GoalProgressFold";
import { hasAutoSyncAssignments } from "./assignment.calculations";
import { readGoalSourceVisibility } from "./GoalViewerProgress";
import { postGoalTransferIn } from "./goalInvestmentTransfer";
import { setGoalArchivedWithAudit, type GoalAuditRequest } from "./GoalWriteAudit";
import type { HouseholdContext } from "../../middleware/householdGuard";

export interface ContributionOptions {
  date?: string;
  notes?: string;
  transactionId?: string;
  /** The currency the caller sent; it must be the goal's own. */
  currency?: string;
  /** NEW-29: the caller accepts taking progress past the target. */
  confirmOverfund?: boolean;
  ipAddress?: string;
  /** The requesting member; whether they can see the goal's progress decides the overfund check. */
  actor?: HouseholdContext;
}

async function isLinkedAsContribution(tx: TransactionType, goalId: string, transactionId: string): Promise<boolean> {
  const [linked] = await tx.select({ id: transactionGoalLinks.id }).from(transactionGoalLinks).where(and(
    eq(transactionGoalLinks.goalId, goalId), eq(transactionGoalLinks.transactionId, transactionId),
    eq(transactionGoalLinks.linkType, "contribution"),
  )).limit(1);
  return linked !== undefined;
}

async function assertNotLinkedAsContribution(tx: TransactionType, goalId: string, transactionId: string) {
  if (await isLinkedAsContribution(tx, goalId, transactionId)) {
    throw new ConflictError("This transaction is linked to the goal as a contribution, so it already counts toward the goal");
  }
}

const AUTO_SYNC_REFUSAL = "Cannot add contributions to goals with auto-synced accounts";

function linkedTransactionNotFound(): ValidationError {
  return new ValidationError("Linked transaction not found", [
    { field: "transactionId", message: "Transaction not found or not in household" },
  ]);
}

export class GoalContributionService extends GoalMutationService {
  async addContribution(
    id: string,
    householdId: string,
    userId: string,
    amount: string,
    options?: ContributionOptions
  ) {
    const amountMoney = new Money(amount);
    if (amountMoney.isNegativeOrZero()) {
      throw new ValidationError("Invalid contribution amount", [
        { field: "amount", message: "Must be a positive number" },
      ]);
    }

    const existing = await this.getGoalById(id, householdId);
    if (existing.type === "pay_down") {
      throw new ValidationError(
        "Contributions are not supported for pay down goals"
      );
    }

    // #235 M2, R2-5: hidden progress decides completion, so a member who
    // cannot see all of it gets one refusal, completed or not; it is checked
    // again under the lock.
    if (options?.actor && (await readGoalSourceVisibility(options.actor, [id])).get(id)?.progressVisible !== true) {
      throw new ConflictError(HIDDEN_GOAL_WRITE_REFUSAL);
    }
    if (existing.isCompleted) {
      throw new ValidationError("Goal is already completed", [
        { field: "goalId", message: "Cannot add contributions to completed goals" },
      ]);
    }

    if (options?.currency && options.currency !== existing.currency) {
      throw new ValidationError("Contribution currency must match the goal currency", [
        { field: "amount.currency", message: `This goal is in ${existing.currency}` },
      ]);
    }

    const hasAutoSync = await this.hasAutoSyncAssignments(existing.id);
    const usesHoldings =
      existing.type === "investment" && existing.progressSource === "holdings";
    if (hasAutoSync && !usesHoldings) throw new ValidationError(AUTO_SYNC_REFUSAL);

    // Rule 11: a contribution may only cite a transaction this member can see.
    if (options?.transactionId) {
      const txn = await transactionRepository.findByIdWithVisibility(
        options.transactionId,
        householdId,
        userId
      );
      if (!txn) throw linkedTransactionNotFound();
    }

    // An undated contribution is dated on the household's own calendar, not the server's UTC day.
    const contributionDate = options?.date || await householdToday(db, householdId);
    return await withTransaction(async (tx) => {
      // Household first: the audit FK lock order (FIN-13, see GoalWriteAudit).
      await lockAccountHousehold(tx, householdId);
      // The transaction writers lock a transaction, then its linked goals. A
      // cited transaction is locked first here too (KEY SHARE is what the
      // foreign key needs anyway), so this never holds the goal while
      // waiting for a writer that waits for the goal. The locked reads
      // recheck the transaction's and its account's privacy after any wait,
      // in the writers' order: transaction, account, goal.
      if (options?.transactionId) {
        const [cited] = await tx.select({ accountId: transactions.accountId }).from(transactions).where(and(
          eq(transactions.id, options.transactionId), eq(transactions.householdId, householdId),
          isNull(transactions.deletedAt), or(eq(transactions.isPrivate, false), eq(transactions.ownerUserId, userId)),
        )).for("key share").limit(1);
        if (!cited) throw linkedTransactionNotFound();
        const [account] = await tx.select({ id: accounts.id }).from(accounts).where(and(
          eq(accounts.id, cited.accountId), or(eq(accounts.isPrivate, false), eq(accounts.ownerUserId, userId)),
        )).for("share").limit(1);
        if (!account) throw linkedTransactionNotFound();
      }

      // FOR UPDATE serialises concurrent contributions on the same goal, so
      // each one is checked and applied against the committed progress.
      const [lockedGoal] = await tx
        .select()
        .from(goals)
        .where(and(eq(goals.id, id), eq(goals.householdId, householdId)))
        .for("update")
        .limit(1);

      if (!lockedGoal) {
        throw new NotFoundError("Goal not found");
      }
      // The check above ran before this lock; an auto-synced assignment may
      // have committed while we waited, and it replaces progress outright.
      if (!usesHoldings && await hasAutoSyncAssignments(id, tx)) throw new ValidationError(AUTO_SYNC_REFUSAL);
      const goalAmount = new Money(amountMoney.toString(), lockedGoal.currency);
      // FIN-01 under the lock: a hidden source that committed while we waited
      // gives the same refusal, not the completed or target answer.
      if (options?.actor && (await readGoalSourceVisibility(options.actor, [id], tx)).get(id)?.progressVisible !== true) {
        throw new ConflictError(HIDDEN_GOAL_WRITE_REFUSAL);
      }
      assertWithinTarget(lockedGoal, goalAmount, options?.confirmOverfund === true, false);
      // A transaction counts toward a goal once (GoalProgressFold).
      if (options?.transactionId) await assertNotLinkedAsContribution(tx, id, options.transactionId);

      let investmentTransactionId: string | null = null;
      let transferConversion: Awaited<ReturnType<typeof postGoalTransferIn>>["audit"] = { value: {}, metadata: {} };
      if (usesHoldings) {
        // Cash moves into the linked investment account; progress follows the
        // holdings, so the goal row itself does not change here.
        const accountId = await this.resolveInvestmentGoalAccount(lockedGoal, tx);
        if (!accountId) {
          throw new ValidationError(
            "Investment goal must be linked to an investment account",
            [{ field: "linkedAccountId", message: "Missing linked account" }]
          );
        }
        // F6: the transfer stores its dated ZMW base; a missing rate refuses the whole contribution.
        const posted = await postGoalTransferIn(tx, householdId, lockedGoal, accountId, goalAmount, contributionDate, options?.notes);
        investmentTransactionId = posted.transaction.id;
        transferConversion = posted.audit;
      }

      // Written at its applied-order place with a pending effect, then folded;
      // a holdings-tracked goal's progress follows holdings instead.
      const [inserted] = await tx
        .insert(goalContributions)
        .values({
          goalId: id,
          amount: goalAmount.toString(),
          date: contributionDate,
          notes: options?.notes,
          transactionId: options?.transactionId,
          appliedDelta: usesHoldings ? null : PENDING_EFFECT,
          createdBy: userId,
          createdAt: sourceTimeSql(id),
        })
        .returning();
      const unchanged = new Money(lockedGoal.currentAmount, lockedGoal.currency);
      const refold = usesHoldings ? null : await refoldGoalProgress(tx, lockedGoal, { from: inserted.id });
      const write = refold?.write ?? { goal: lockedGoal, previous: unchanged, next: unchanged };
      const contribution = refold ? { ...inserted, appliedDelta: refold.net.toString() } : inserted;

      await goalActivityLogService.log({
        goalId: id,
        activityType: "contribution_added",
        amount: goalAmount,
        previousBalance: write.previous,
        newBalance: write.next,
        metadata: investmentTransactionId
          ? { investmentTransactionId }
          : { transactionId: options?.transactionId ?? null },
        createdBy: userId,
        tx,
      });

      await businessAuditService.logUpdate({
        tx,
        userId,
        householdId,
        entityId: id,
        entityType: "goal",
        newValue: { amount: goalAmount.toString(), currency: lockedGoal.currency, date: contributionDate,
          notes: options?.notes, transactionId: options?.transactionId, ...transferConversion.value },
        metadata: { operation: "addContribution", contributionId: contribution.id,
          confirmOverfund: options?.confirmOverfund === true, investmentTransactionId, ...transferConversion.metadata },
        ipAddress: options?.ipAddress,
      });

      if (!usesHoldings) await notifyGoalMilestone(tx, householdId, lockedGoal, write.goal);
      logger.info("Contribution added to goal", { householdId, goalId: id });

      return { goal: write.goal, contribution };
    });
  }

  /**
   * Reverses a mistaken manual contribution by writing a correction row that
   * points at it; the original row is never deleted. A contribution can be
   * reversed once. One that mirrors a contribution link is reversed by
   * unlinking that transaction instead.
   */
  async reverseContribution(
    goalId: string,
    contributionId: string,
    actor: HouseholdContext,
    options?: { reason?: string; ipAddress?: string }
  ) {
    const { householdId, userId } = actor;
    // Rule 11: a goal whose progress this member cannot see is not theirs to correct.
    const visibility = await readGoalSourceVisibility(actor, [goalId]);
    if (visibility.get(goalId)?.progressVisible !== true) {
      throw new NotFoundError("Contribution not found");
    }

    return await withTransaction(async (tx) => {
      // Household first: the audit FK lock order (FIN-13, see GoalWriteAudit).
      await lockAccountHousehold(tx, householdId);
      const [goal] = await tx.select().from(goals)
        .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId)))
        .for("update").limit(1);
      if (!goal) throw new NotFoundError("Contribution not found");

      const [original] = await tx.select().from(goalContributions)
        .where(and(eq(goalContributions.id, contributionId), eq(goalContributions.goalId, goalId)))
        .for("update").limit(1);
      if (!original) throw new NotFoundError("Contribution not found");
      if (original.kind === "correction") {
        throw new ValidationError("A correction cannot itself be reversed");
      }
      // A link's mirror row is reversed by unlinking; a manual contribution
      // that only cites a transaction is reversed here.
      if (original.transactionId && await isLinkedAsContribution(tx, goalId, original.transactionId)) {
        throw new ValidationError("Unlink the transaction to reverse a contribution that came from it");
      }
      if (goal.type === "investment" && goal.progressSource === "holdings") {
        throw new ValidationError("Reverse the investment transfer: this goal's progress follows its holdings");
      }

      const [already] = await tx.select({ id: goalContributions.id }).from(goalContributions)
        .where(eq(goalContributions.correctsContributionId, contributionId)).limit(1);
      if (already) throw new ConflictError("This contribution has already been reversed", already.id);

      // The correction takes back what the original still holds, folded at its
      // applied-order place like every other source (GoalProgressFold).
      const amount = new Money(original.amount, goal.currency);
      const [inserted] = await tx.insert(goalContributions).values({
        goalId,
        amount: amount.negated().toString(),
        // Dated on the household's calendar, like an undated contribution.
        date: await householdToday(tx, householdId),
        notes: options?.reason ?? null,
        kind: "correction",
        correctsContributionId: contributionId,
        appliedDelta: PENDING_EFFECT,
        createdBy: userId,
        createdAt: sourceTimeSql(goalId),
      }).returning();
      const { write, net: reversed } = await refoldGoalProgress(tx, goal, { from: inserted.id });
      const correction = { ...inserted, appliedDelta: reversed.toString() };

      await goalActivityLogService.log({
        goalId,
        activityType: "contribution_removed",
        amount: reversed,
        previousBalance: write.previous,
        newBalance: write.next,
        metadata: { contributionId, correctionId: correction.id },
        createdBy: userId,
        tx,
      });

      await businessAuditService.log({
        tx,
        userId,
        householdId,
        action: "CREATE",
        entityType: "goal",
        entityId: goalId,
        details: { operation: "reverseContribution", contributionId, correctionId: correction.id,
          amount: amount.toString(), reversedDelta: reversed.toString(), reason: options?.reason ?? null },
        ipAddress: options?.ipAddress,
      });

      return { goal: write.goal, correction };
    });
  }

  /** A contribution from a transaction the viewer cannot see is left out (FIN-01, Rule 11). */
  async getContributions(id: string, actor: HouseholdContext) {
    const existing = await this.getGoalById(id, actor.householdId);
    if (!existing) {
      throw new NotFoundError("Goal not found");
    }
    // #184 finding 3: a holdings contribution moved cash into the goal's
    // investment account, which may be another member's private account.
    const usesHoldings = existing.type === "investment" && existing.progressSource === "holdings";
    const uncitedVisible = !usesHoldings ||
      (await readGoalSourceVisibility(actor, [id])).get(id)?.progressVisible === true;
    return await goalRepository.getVisibleContributions(id, actor, uncitedVisible);
  }

  async setArchived(
    id: string,
    householdId: string,
    userId: string,
    isArchived: boolean,
    /** Request context for the business audit row, written in the same transaction (FIN-13). */
    audit?: GoalAuditRequest,
  ): Promise<Goal> {
    return withTransaction(tx => setGoalArchivedWithAudit(tx, id, householdId, userId, isArchived, audit));
  }

  async completeGoal(
    id: string, householdId: string, userId: string,
    /** The member completing it over HTTP; system callers omit it. */
    viewer?: HouseholdContext,
    /** Request context for the business audit row, written in the same transaction (Rule 9). */
    audit: { ipAddress?: string } = {},
  ) {
    const { percentBefore, updated } = await withTransaction(async (tx) => {
      // Household first: the audit FK lock order (FIN-13, see GoalWriteAudit).
      await lockAccountHousehold(tx, householdId);
      const [goal] = await tx.select().from(goals)
        .where(and(eq(goals.id, id), eq(goals.householdId, householdId)))
        .for("update")
        .limit(1);
      if (!goal) throw new NotFoundError("Goal not found");
      // The same answer as a contribution or an edit (#235 R2-5, goals QA), read
      // under the lock so a source made private while we waited still refuses.
      if (viewer && (await readGoalSourceVisibility(viewer, [id], tx)).get(id)?.progressVisible !== true) {
        throw new ConflictError(HIDDEN_GOAL_WRITE_REFUSAL);
      }
      const before = calculatePercentComplete(goal);
      const row = await goalRepository.update(id, householdId, {
        isCompleted: true,
        status: "completed",
        completedAt: new Date(),
      }, tx);
      if (!row) throw new NotFoundError("Goal not found");
      await goalActivityLogService.log({
        goalId: row.id,
        activityType: "goal_completed",
        metadata: { percentComplete: 100, previousPercent: before },
        createdBy: userId,
        tx,
      });
      await businessAuditService.logUpdate({
        userId,
        householdId,
        entityId: id,
        entityType: "goal",
        newValue: { status: "completed" },
        metadata: { operation: "completeGoal" },
        ipAddress: audit.ipAddress,
        tx,
      });
      return { percentBefore: before, updated: row };
    });

    notificationService
      .triggerGoalMilestone(
        householdId,
        updated.id,
        updated.name,
        percentBefore,
        100
      )
      .catch(() => undefined);

    return updated;
  }
}
