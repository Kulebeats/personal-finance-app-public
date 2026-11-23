import { db } from "../db";
import {
  goalTransfers,
  goals,
  type Goal,
} from "@shared/schema";
import { and, eq, getTableColumns, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { visibleGoalProgressSources } from "../core/authz/goal-progress-visibility";
import { Money } from "../core/money";
import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errorHandler";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { goalActivityLogService } from "./GoalActivityLogService";
import { calculatePercentComplete } from "./goalCalculations";
import { applyProgressAdjustment } from "./goal/GoalProgressAdjustments";
import { assertWithinTarget } from "./goal/GoalProgressSources";
import { readGoalSourceVisibility, type GoalSourceVisibility } from "./goal/GoalViewerProgress";
import type { HouseholdContext } from "../middleware/householdGuard";

/**
 * One answer for every transfer out of a goal whose progress the caller
 * cannot see, whatever the amount or the goal's state: no digits, and it names
 * what the caller can do instead (FIN-01, #222 round 4).
 */
export const HIDDEN_SOURCE_TRANSFER_MESSAGE =
  "You can't move money out of this goal because some of its progress comes from sources you can't see. Ask a member who can see all of this goal's progress to make the transfer.";
import { notificationService } from "./NotificationService";
import { businessAuditService } from "./BusinessAuditService";

/** Whether `viewer` can see all of this goal's progress; a missing goal is hidden. */
function goalProgressVisibleTo(viewer: HouseholdContext, goalId: AnyPgColumn) {
  return sql<boolean>`coalesce((select ${visibleGoalProgressSources(viewer)} from ${goals}
    where ${goals.id} = ${goalId}), false)`;
}

/**
 * A transfer's columns plus, in the same read, whether the viewer may see its
 * amount: only when both goals' progress is visible to them (owner decision on
 * #235 F1, "hide the amount"). That the transfer happened stays visible.
 */
function viewerTransferColumns(viewer: HouseholdContext) {
  return {
    ...getTableColumns(goalTransfers),
    amountVisible: sql<boolean>`(${goalProgressVisibleTo(viewer, goalTransfers.fromGoalId)}
      and ${goalProgressVisibleTo(viewer, goalTransfers.toGoalId)})`,
  };
}

export class GoalTransferService {
  async transfer(
    householdId: string,
    userId: string,
    data: {
      fromGoalId: string;
      toGoalId: string;
      /** The amount in its own currency, which must be both goals' (A-06). */
      amount: { amount: string; currency: string };
      reason?: string | null;
      confirmOverfund?: boolean;
    },
    /** The member making the transfer over HTTP; system callers omit it. */
    viewer?: HouseholdContext,
    ipAddress?: string,
  ) {
    const transferAmount = new Money(data.amount.amount);
    const transferCurrency = data.amount.currency.toUpperCase();
    if (transferAmount.isNegativeOrZero()) {
      throw new ValidationError("Transfer amount must be positive");
    }

    // CRITICAL: All reads and writes MUST be inside the transaction with row locking
    // to prevent double-spend race conditions
    return await withTransaction(async (tx) => {
      // DEADLOCK SAFETY (CLAUDE.md Rule 10): acquire the two row locks in a
      // consistent global order — ascending goal id — NOT in request order.
      //
      // Locking in request order deadlocks: a transfer A→B locks A then waits on
      // B, while a concurrent B→A locks B then waits on A. Each holds what the
      // other needs, so Postgres breaks the cycle by killing one with a
      // deadlock error (40P01) — a spurious 500 on a legitimate transfer.
      //
      // Sorting by id means every transfer touching {A,B} takes A's lock first
      // regardless of direction, so the second transfer simply waits for the
      // first to commit instead of deadlocking against it. The two goals are
      // locked before any balance is read, preserving the double-spend guard.
      const [firstId, secondId] =
        data.fromGoalId <= data.toGoalId
          ? [data.fromGoalId, data.toGoalId]
          : [data.toGoalId, data.fromGoalId];

      const lockedGoals = new Map<string, Goal>();
      lockedGoals.set(
        firstId,
        await this.getGoalForUpdate(tx, firstId, householdId),
      );
      // Same-goal transfers resolve to one id; re-locking it would be a no-op,
      // and validateTransfer rejects them below.
      if (secondId !== firstId) {
        lockedGoals.set(
          secondId,
          await this.getGoalForUpdate(tx, secondId, householdId),
        );
      }

      const fromGoal = lockedGoals.get(data.fromGoalId)!;
      const toGoal = lockedGoals.get(data.toGoalId)!;

      // Under the locks and before any balance or state check, so neither
      // the refusal nor its message depends on progress the caller cannot see.
      if (viewer) {
        const fromVerdict = (await readGoalSourceVisibility(viewer, [fromGoal.id], tx)).get(fromGoal.id);
        if (!fromVerdict?.progressVisible) throw new ForbiddenError(HIDDEN_SOURCE_TRANSFER_MESSAGE);
      }

      // Validate using Money class (no floating point)
      const fromBalanceMoney = new Money(fromGoal.currentAmount);
      this.validateTransfer(fromGoal, toGoal, transferAmount, transferCurrency, fromBalanceMoney);

      const toBalanceMoney = new Money(toGoal.currentAmount);
      // The receiving goal follows the same over-fund rule as a contribution
      // (goals QA F5); a debt goal has no target to overfund.
      if (viewer && toGoal.type !== "pay_down") {
        const toHidden = (await readGoalSourceVisibility(viewer, [toGoal.id], tx)).get(toGoal.id)?.progressVisible !== true;
        assertWithinTarget(toGoal, new Money(data.amount.amount, toGoal.currency), data.confirmOverfund === true, toHidden, "transfer");
      }

      // Insert transfer record
      const [transfer] = await tx
        .insert(goalTransfers)
        .values({
          householdId,
          fromGoalId: data.fromGoalId,
          toGoalId: data.toGoalId,
          amount: transferAmount.toString(),
          reason: data.reason ?? null,
          createdBy: userId,
        })
        .returning();

      // A-23 (Rule 9): the audit row commits with the transfer or not at all.
      await businessAuditService.logCreate({
        tx, userId, householdId, entityId: transfer.id, entityType: "goal_transfer",
        newValue: { ...data, amount: { amount: transferAmount.toString(), currency: transferCurrency } },
        ipAddress,
      });

      // Each side is a progress adjustment at its own place in that goal's
      // applied order, so a later replay of either goal keeps it there
      // (GoalProgressFold). The balance check above means the outgoing side
      // takes the whole amount now.
      const fromWrite = await applyProgressAdjustment(tx, fromGoal, {
        kind: "transfer_out", amount: transferAmount.negated(), refId: transfer.id, createdBy: userId,
      });
      const toWrite = await applyProgressAdjustment(tx, toGoal, {
        kind: "transfer_in", amount: transferAmount, refId: transfer.id, createdBy: userId,
      });
      const updatedFrom = fromWrite.write.goal;
      const updatedTo = toWrite.write.goal;
      const finalFromBalanceMoney = fromWrite.write.next;
      const newToBalanceMoney = toWrite.write.next;

      // Activity logging (convert to numbers only for logging interface)
      await goalActivityLogService.log({
        goalId: fromGoal.id,
        activityType: "transfer_out",
        amount: transferAmount.negated(),
        previousBalance: fromBalanceMoney,
        newBalance: finalFromBalanceMoney,
        metadata: {
          toGoalId: toGoal.id,
          toGoalName: toGoal.name,
          reason: data.reason ?? null,
        },
        createdBy: userId,
        tx,
      });

      await goalActivityLogService.log({
        goalId: toGoal.id,
        activityType: "transfer_in",
        amount: transferAmount,
        previousBalance: toBalanceMoney,
        newBalance: newToBalanceMoney,
        metadata: {
          fromGoalId: fromGoal.id,
          fromGoalName: fromGoal.name,
          reason: data.reason ?? null,
        },
        createdBy: userId,
        tx,
      });

      // Milestone: the audience is decided on this transaction (#235 R2-1); the send is not awaited.
      const percentBefore = calculatePercentComplete(toGoal, toBalanceMoney.toNumber());
      const percentAfter = calculatePercentComplete(toGoal, newToBalanceMoney.toNumber());
      await notificationService.triggerGoalMilestone(
        householdId, updatedTo.id, updatedTo.name, percentBefore, percentAfter, tx,
      );

      // The caller's verdict on both goals, from inside this transaction,
      // so the response is redacted against the snapshot it reports.
      const visibility: Map<string, GoalSourceVisibility> = viewer
        ? await readGoalSourceVisibility(viewer, [updatedFrom.id, updatedTo.id], tx)
        : new Map();
      return {
        transfer,
        fromGoal: updatedFrom,
        toGoal: updatedTo,
        visibility,
      };
    });
  }

  /** Transfers in the household, each with whether `viewer` may see its amount. */
  async getTransfers(householdId: string, viewer: HouseholdContext) {
    return await db
      .select(viewerTransferColumns(viewer))
      .from(goalTransfers)
      .where(eq(goalTransfers.householdId, householdId))
      .orderBy(goalTransfers.createdAt);
  }

  /** A goal's transfers, each with whether `viewer` may see its amount. */
  async getTransfersForGoal(goalId: string, householdId: string, viewer: HouseholdContext) {
    return await db
      .select(viewerTransferColumns(viewer))
      .from(goalTransfers)
      .where(
        and(
          eq(goalTransfers.householdId, householdId),
          or(
            eq(goalTransfers.fromGoalId, goalId),
            eq(goalTransfers.toGoalId, goalId)
          )
        )
      )
      .orderBy(goalTransfers.createdAt);
  }

  /**
   * Fetch a goal with FOR UPDATE row lock to prevent concurrent modifications.
   * MUST be called within a transaction to be effective.
   */
  private async getGoalForUpdate(
    tx: TransactionType,
    goalId: string,
    householdId: string
  ): Promise<Goal> {
    // Use FOR UPDATE to acquire row-level lock, preventing concurrent modifications
    // This is CRITICAL for preventing double-spend race conditions
    const result = await tx
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId)))
      .for("update")
      .limit(1);

    const goal = result[0];
    if (!goal) {
      throw new NotFoundError("Goal not found");
    }

    return goal;
  }

  private validateTransfer(
    fromGoal: Goal,
    toGoal: Goal,
    amount: Money,
    amountCurrency: string,
    fromBalance: Money
  ) {
    if (fromGoal.id === toGoal.id) {
      throw new ValidationError("Cannot transfer to the same goal");
    }

    if (fromGoal.type !== toGoal.type) {
      throw new ValidationError("Cannot transfer between different goal types");
    }

    if (fromGoal.currency !== toGoal.currency) {
      throw new ValidationError("Cannot transfer between goals with different currencies");
    }

    // A-06: the submitted amount's currency is the third unit, checked under the locks.
    if (amountCurrency !== (fromGoal.currency ?? "ZMW").toUpperCase()) {
      throw new ValidationError("The transfer currency must match the goals' currency");
    }

    if (fromGoal.isCompleted) {
      throw new ValidationError("Cannot transfer from a completed goal");
    }

    // Use Money comparison - NO floating point conversion
    if (fromBalance.lt(amount)) {
      throw new ValidationError("Insufficient balance for transfer");
    }
  }
}

export const goalTransferService = new GoalTransferService();
