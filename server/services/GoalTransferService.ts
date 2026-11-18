import { db } from "../db";
import {
  goalTransfers,
  goals,
  type Goal,
} from "@shared/schema";
import { and, eq, or } from "drizzle-orm";
import { Money } from "../core/money";
import { NotFoundError, ValidationError } from "../utils/errorHandler";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { goalActivityLogService } from "./GoalActivityLogService";
import { buildGoalBalanceUpdate, calculatePercentComplete } from "./goalCalculations";
import { notificationService } from "./NotificationService";

export class GoalTransferService {
  async transfer(
    householdId: string,
    userId: string,
    data: {
      fromGoalId: string;
      toGoalId: string;
      amount: string;
      reason?: string | null;
    }
  ) {
    const transferAmount = new Money(data.amount);
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

      // Validate using Money class (no floating point)
      const fromBalanceMoney = new Money(fromGoal.currentAmount);
      this.validateTransfer(fromGoal, toGoal, transferAmount, fromBalanceMoney);

      const toBalanceMoney = new Money(toGoal.currentAmount);

      // All arithmetic stays in Money class - no floating point operations
      const newFromBalanceMoney = fromBalanceMoney.subtract(transferAmount);
      const newToBalanceMoney = toBalanceMoney.add(transferAmount);

      // Ensure non-negative (using Money comparison, not Math.max)
      const zeroMoney = new Money("0");
      const finalFromBalanceMoney = newFromBalanceMoney.isNegative()
        ? zeroMoney
        : newFromBalanceMoney;

      // Build updates using Money objects directly (preserves precision)
      const fromUpdate = buildGoalBalanceUpdate(fromGoal, finalFromBalanceMoney);
      const toUpdate = buildGoalBalanceUpdate(toGoal, newToBalanceMoney);

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

      const [updatedFrom] = await tx
        .update(goals)
        .set({
          currentAmount: fromUpdate.currentAmount,
          status: fromUpdate.status,
          monthlyProjection: fromUpdate.monthlyProjection,
          projectedCompletionDate: fromUpdate.projectedCompletionDate,
          isCompleted: fromUpdate.isCompleted,
          completedAt: fromUpdate.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, fromGoal.id))
        .returning();

      const [updatedTo] = await tx
        .update(goals)
        .set({
          currentAmount: toUpdate.currentAmount,
          status: toUpdate.status,
          monthlyProjection: toUpdate.monthlyProjection,
          projectedCompletionDate: toUpdate.projectedCompletionDate,
          isCompleted: toUpdate.isCompleted,
          completedAt: toUpdate.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, toGoal.id))
        .returning();

      // Activity logging (convert to numbers only for logging interface)
      await goalActivityLogService.log({
        goalId: fromGoal.id,
        activityType: "transfer_out",
        amount: -transferAmount.toNumber(),
        previousBalance: fromBalanceMoney.toNumber(),
        newBalance: finalFromBalanceMoney.toNumber(),
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
        amount: transferAmount.toNumber(),
        previousBalance: toBalanceMoney.toNumber(),
        newBalance: newToBalanceMoney.toNumber(),
        metadata: {
          fromGoalId: fromGoal.id,
          fromGoalName: fromGoal.name,
          reason: data.reason ?? null,
        },
        createdBy: userId,
        tx,
      });

      // Milestone notifications (async, non-blocking)
      const percentBefore = calculatePercentComplete(toGoal, toBalanceMoney.toNumber());
      const percentAfter = calculatePercentComplete(toGoal, newToBalanceMoney.toNumber());
      notificationService
        .triggerGoalMilestone(
          householdId,
          updatedTo.id,
          updatedTo.name,
          percentBefore,
          percentAfter
        )
        .catch(() => undefined);

      return {
        transfer,
        fromGoal: updatedFrom,
        toGoal: updatedTo,
      };
    });
  }

  async getTransfers(householdId: string) {
    return await db
      .select()
      .from(goalTransfers)
      .where(eq(goalTransfers.householdId, householdId))
      .orderBy(goalTransfers.createdAt);
  }

  async getTransfersForGoal(goalId: string, householdId: string) {
    return await db
      .select()
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
