import { eq } from "drizzle-orm";
import {
  goalContributions,
  goals,
  investmentTransactions,
  type Goal,
} from "@shared/schema";
import { Money } from "../../core/money";
import { goalRepository } from "../../repositories/GoalRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { withTransaction } from "../../utils/withTransaction";
import {
  buildGoalBalanceUpdate,
  calculatePercentComplete,
} from "../goalCalculations";
import { goalActivityLogService } from "../GoalActivityLogService";
import { notificationService } from "../NotificationService";
import { GoalMutationService } from "./GoalMutationService";

export class GoalContributionService extends GoalMutationService {
  async addContribution(
    id: string,
    householdId: string,
    userId: string,
    amount: string,
    options?: { date?: string; notes?: string; transactionId?: string }
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

    if (existing.isCompleted) {
      throw new ValidationError("Goal is already completed", [
        { field: "goalId", message: "Cannot add contributions to completed goals" },
      ]);
    }

    const hasAutoSync = await this.hasAutoSyncAssignments(existing.id);
    const usesHoldings =
      existing.type === "investment" && existing.progressSource === "holdings";
    if (hasAutoSync && !usesHoldings) {
      throw new ValidationError(
        "Cannot add contributions to goals with auto-synced accounts"
      );
    }

    if (options?.transactionId) {
      const txn = await transactionRepository.findById(
        options.transactionId,
        householdId
      );
      if (!txn) {
        throw new ValidationError("Linked transaction not found", [
          { field: "transactionId", message: "Transaction not found or not in household" },
        ]);
      }
    }

    if (usesHoldings) {
      return await withTransaction(async (tx) => {
        const accountId = await this.resolveInvestmentGoalAccount(existing, tx);

        if (!accountId) {
          throw new ValidationError(
            "Investment goal must be linked to an investment account",
            [{ field: "linkedAccountId", message: "Missing linked account" }]
          );
        }

        const [investmentTx] = await tx
          .insert(investmentTransactions)
          .values({
            householdId,
            accountId,
            type: "transfer_in",
            amount: amountMoney.toString(),
            currency: existing.currency,
            transactionDate:
              options?.date || new Date().toISOString().split("T")[0],
            notes: options?.notes || `Goal contribution: ${existing.name}`,
          })
          .returning();

        const [contribution] = await tx
          .insert(goalContributions)
          .values({
            goalId: id,
            amount: amountMoney.toString(),
            date: options?.date || new Date().toISOString().split("T")[0],
            notes: options?.notes,
          })
          .returning();

        const previousBalanceForLog = new Money(existing.currentAmount);
        await goalActivityLogService.log({
          goalId: id,
          activityType: "contribution_added",
          amount: amountMoney.toNumber(),
          previousBalance: previousBalanceForLog.toNumber(),
          newBalance: previousBalanceForLog.toNumber(),
          metadata: { investmentTransactionId: investmentTx.id },
          createdBy: userId,
          tx,
        });

        logger.info("Contribution recorded for investment goal", {
          householdId,
          goalId: id,
        });

        return { goal: existing, contribution };
      });
    }

    return await withTransaction(async (tx) => {
      // Re-fetch goal with FOR UPDATE lock to prevent concurrent modifications
      // CRITICAL: This prevents race conditions when multiple contributions are added simultaneously
      const [lockedGoal] = await tx
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .for("update")
        .limit(1);

      if (!lockedGoal) {
        throw new NotFoundError("Goal not found");
      }

      // Use locked goal's current amount for accurate balance calculation
      const currentAmountMoney = new Money(lockedGoal.currentAmount);
      const newBalanceMoney = currentAmountMoney.add(amountMoney);
      // Convert to number at the boundary for buildGoalBalanceUpdate and activity logging
      const previousBalance = currentAmountMoney.toNumber();
      const newBalance = newBalanceMoney.toNumber();
      const update = buildGoalBalanceUpdate(lockedGoal, newBalance);

      const [updatedGoal] = await tx
        .update(goals)
        .set({
          currentAmount: update.currentAmount,
          status: update.status,
          monthlyProjection: update.monthlyProjection,
          projectedCompletionDate: update.projectedCompletionDate,
          isCompleted: update.isCompleted,
          completedAt: update.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(goals.id, id))
        .returning();

      const [contribution] = await tx
        .insert(goalContributions)
        .values({
          goalId: id,
          amount: amountMoney.toString(),
          date: options?.date || new Date().toISOString().split("T")[0],
          notes: options?.notes,
          transactionId: options?.transactionId,
        })
        .returning();

      await goalActivityLogService.log({
        goalId: id,
        activityType: "contribution_added",
        amount: amountMoney.toNumber(),
        previousBalance,
        newBalance,
        metadata: { transactionId: options?.transactionId ?? null },
        createdBy: userId,
        tx,
      });

      const percentBefore = calculatePercentComplete(existing, previousBalance);
      const percentAfter = calculatePercentComplete(existing, newBalance);
      notificationService
        .triggerGoalMilestone(
          householdId,
          id,
          updatedGoal.name,
          percentBefore,
          percentAfter
        )
        .catch(() => undefined);

      logger.info("Contribution added to goal", { householdId });

      return { goal: updatedGoal, contribution };
    });
  }

  async getContributions(id: string, householdId: string) {
    const existing = await this.getGoalById(id, householdId);
    if (!existing) {
      throw new NotFoundError("Goal not found");
    }

    return await goalRepository.getContributions(id);
  }

  async setArchived(
    id: string,
    householdId: string,
    userId: string,
    isArchived: boolean
  ): Promise<Goal> {
    const goal = isArchived
      ? await goalRepository.archive(id, householdId)
      : await goalRepository.unarchive(id, householdId);

    if (!goal) {
      throw new NotFoundError("Goal not found");
    }

    await goalActivityLogService.log({
      goalId: goal.id,
      activityType: isArchived ? "goal_archived" : "goal_unarchived",
      metadata: null,
      createdBy: userId,
    });

    return goal;
  }

  async completeGoal(id: string, householdId: string, userId: string) {
    const goal = await this.getGoalById(id, householdId);
    const percentBefore = calculatePercentComplete(goal);

    const updated = await goalRepository.update(id, householdId, {
      isCompleted: true,
      status: "completed",
      completedAt: new Date(),
    });

    if (!updated) {
      throw new NotFoundError("Goal not found");
    }

    await goalActivityLogService.log({
      goalId: updated.id,
      activityType: "goal_completed",
      metadata: { percentComplete: 100, previousPercent: percentBefore },
      createdBy: userId,
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
