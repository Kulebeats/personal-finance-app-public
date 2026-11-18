import { db } from "../db";
import {
  goalContributions,
  goals,
  transactionGoalLinks,
  transactions,
  type Goal,
} from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../utils/errorHandler";
import { withTransaction, type TransactionType } from "../utils/withTransaction";
import { goalActivityLogService } from "./GoalActivityLogService";
import { buildGoalBalanceUpdate, calculatePercentComplete } from "./goalCalculations";
import { Money } from "../core/money";
import { notificationService } from "./NotificationService";
import { transactionRepository } from "../repositories/TransactionRepository";
import { validateTransactionLink } from "./TransactionGoalLinkValidation";

export class TransactionGoalLinkService {
  async linkTransaction(
    goalId: string,
    householdId: string,
    userId: string | null,
    data: {
      transactionId: string;
      linkType: "contribution" | "spending";
      amount?: string;
    },
    externalTx?: TransactionType
  ) {
    // Fetch transaction with visibility check (CLAUDE.md Rule 11 - verify visibility when linking)
    // This prevents User A from linking User B's private transaction to a goal
    const transaction = await this.getTransactionWithVisibility(
      data.transactionId,
      householdId,
      userId
    );

    // Keep amount in Money class to avoid floating point errors
    const amountMoney = data.amount
      ? new Money(data.amount)
      : new Money(transaction.amount).abs();

    if (amountMoney.isNegativeOrZero()) {
      throw new ValidationError("Invalid link amount");
    }

    // SCP-334: when an external transaction is provided (e.g. atomic rule
    // application), run the FOR UPDATE link logic inside that same transaction
    // so a failure here rolls back the whole rule apply. Otherwise open our own.
    const operation = async (tx: TransactionType) => {
      // Lock the goal row to prevent concurrent modifications
      const [goal] = await tx
        .select()
        .from(goals)
        .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId)))
        .for("update")
        .limit(1);

      if (!goal) {
        throw new NotFoundError("Goal not found");
      }

      // Validate link type within transaction
      await validateTransactionLink(goal, transaction, data.linkType);

      // Check for existing link within transaction to prevent race condition
      const [existing] = await tx
        .select()
        .from(transactionGoalLinks)
        .where(
          and(
            eq(transactionGoalLinks.transactionId, data.transactionId),
            eq(transactionGoalLinks.goalId, goalId)
          )
        )
        .limit(1);

      if (existing) {
        throw new ValidationError("Transaction is already linked to this goal");
      }

      const [link] = await tx
        .insert(transactionGoalLinks)
        .values({
          transactionId: data.transactionId,
          goalId,
          amount: amountMoney.toString(),
          linkType: data.linkType,
          linkedBy: userId ?? null,
        })
        .returning();

      // Keep all calculations in Money class to avoid floating point errors
      const currentBalanceMoney = new Money(goal.currentAmount);
      let newBalanceMoney: Money;

      if (data.linkType === "contribution") {
        newBalanceMoney = currentBalanceMoney.add(amountMoney);
      } else {
        // spending - ensure non-negative using Money comparison
        const subtracted = currentBalanceMoney.subtract(amountMoney);
        newBalanceMoney = subtracted.isNegative() ? Money.zero() : subtracted;
      }

      // Only convert to number at the final step for buildGoalBalanceUpdate
      const newBalance = newBalanceMoney.toNumber();

      const update = buildGoalBalanceUpdate(goal, newBalance);

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
        .where(eq(goals.id, goalId))
        .returning();

      if (data.linkType === "contribution") {
        const existingContribution = await tx
          .select({ id: goalContributions.id })
          .from(goalContributions)
          .where(
            and(
              eq(goalContributions.goalId, goalId),
              eq(goalContributions.transactionId, data.transactionId)
            )
          )
          .limit(1);

        if (existingContribution.length === 0) {
          await tx.insert(goalContributions).values({
            goalId,
            amount: amountMoney.toString(),
            date: transaction.date,
            notes: transaction.notes ?? null,
            transactionId: data.transactionId,
          });
        }
      }

      // Convert to numbers only for logging interface (which expects numbers)
      const amountForLog = amountMoney.toNumber();
      const previousBalanceForLog = currentBalanceMoney.toNumber();

      await goalActivityLogService.log({
        goalId,
        activityType: "transaction_linked",
        amount: data.linkType === "spending" ? -amountForLog : amountForLog,
        previousBalance: previousBalanceForLog,
        newBalance,
        metadata: {
          transactionId: data.transactionId,
          transactionName: transaction.name,
          linkType: data.linkType,
        },
        createdBy: userId ?? null,
        tx,
      });

      if (data.linkType === "contribution") {
        const percentBefore = calculatePercentComplete(goal, previousBalanceForLog);
        const percentAfter = calculatePercentComplete(goal, newBalance);
        notificationService
          .triggerGoalMilestone(
            householdId,
            updatedGoal.id,
            updatedGoal.name,
            percentBefore,
            percentAfter
          )
          .catch(() => undefined);
      }

      return {
        link,
        goal: updatedGoal,
      };
    };

    return externalTx
      ? await operation(externalTx)
      : await withTransaction(operation);
  }

  async unlinkTransaction(
    goalId: string,
    transactionId: string,
    householdId: string,
    userId: string
  ) {
    // Fetch transaction outside transaction (read-only, doesn't need lock)
    const transaction = await this.getTransaction(transactionId, householdId);

    return await withTransaction(async (tx) => {
      // Lock the goal row to prevent concurrent modifications
      const [goal] = await tx
        .select()
        .from(goals)
        .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId)))
        .for("update")
        .limit(1);

      if (!goal) {
        throw new NotFoundError("Goal not found");
      }

      // Fetch link within transaction to ensure consistency
      const [link] = await tx
        .select()
        .from(transactionGoalLinks)
        .where(
          and(
            eq(transactionGoalLinks.transactionId, transactionId),
            eq(transactionGoalLinks.goalId, goalId)
          )
        )
        .limit(1);

      if (!link) {
        throw new NotFoundError("Link not found");
      }

      await tx
        .delete(transactionGoalLinks)
        .where(eq(transactionGoalLinks.id, link.id));

      if (link.linkType === "contribution") {
        await tx
          .delete(goalContributions)
          .where(
            and(
              eq(goalContributions.goalId, goalId),
              eq(goalContributions.transactionId, transactionId)
            )
          );
      }

      // Keep all calculations in Money class to avoid floating point errors
      const currentBalanceMoney = new Money(goal.currentAmount);
      const linkAmountMoney = new Money(link.amount);
      let newBalanceMoney: Money;

      if (link.linkType === "contribution") {
        // Unlinking contribution = subtract from balance
        const subtracted = currentBalanceMoney.subtract(linkAmountMoney);
        newBalanceMoney = subtracted.isNegative() ? Money.zero() : subtracted;
      } else {
        // Unlinking spending = add back to balance
        newBalanceMoney = currentBalanceMoney.add(linkAmountMoney);
      }

      // Only convert to number at the final step
      const newBalance = newBalanceMoney.toNumber();
      const update = buildGoalBalanceUpdate(goal, newBalance);

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
        .where(eq(goals.id, goalId))
        .returning();

      // Convert to numbers only for logging interface
      const linkAmountForLog = linkAmountMoney.toNumber();
      const previousBalanceForLog = currentBalanceMoney.toNumber();

      await goalActivityLogService.log({
        goalId,
        activityType: "transaction_unlinked",
        amount: link.linkType === "spending" ? linkAmountForLog : -linkAmountForLog,
        previousBalance: previousBalanceForLog,
        newBalance,
        metadata: {
          transactionId,
          transactionName: transaction.name,
          linkType: link.linkType,
        },
        createdBy: userId,
        tx,
      });

      return {
        success: true,
        goal: updatedGoal,
      };
    });
  }

  private async getGoal(goalId: string, householdId: string): Promise<Goal> {
    const [goal] = await db
      .select()
      .from(goals)
      .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId)))
      .limit(1);

    if (!goal) {
      throw new NotFoundError("Goal not found");
    }

    return goal;
  }

  /**
   * Get transaction with visibility check.
   * Per CLAUDE.md Rule 11: Always check visibility when linking entities across tables.
   * Prevents User A from linking User B's private transaction to a goal.
   */
  private async getTransactionWithVisibility(
    transactionId: string,
    householdId: string,
    userId: string | null
  ) {
    // Use repository method that checks both transaction and account visibility
    const transaction = await transactionRepository.findByIdWithVisibility(
      transactionId,
      householdId,
      userId ?? ""
    );

    if (!transaction) {
      throw new NotFoundError("Transaction not found or not visible");
    }

    return transaction;
  }

  /**
   * Get transaction without visibility check (for internal operations like unlinking).
   * @deprecated Use getTransactionWithVisibility for user-initiated operations
   */
  private async getTransaction(transactionId: string, householdId: string) {
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.householdId, householdId)
        )
      )
      .limit(1);

    if (!transaction) {
      throw new NotFoundError("Transaction not found");
    }

    return transaction;
  }

  async getLinkedTransactions(goalId: string, householdId: string) {
    await this.getGoal(goalId, householdId);

    const rows = await db
      .select({ link: transactionGoalLinks, transaction: transactions })
      .from(transactionGoalLinks)
      .innerJoin(
        transactions,
        eq(transactionGoalLinks.transactionId, transactions.id)
      )
      .where(
        and(
          eq(transactionGoalLinks.goalId, goalId),
          eq(transactions.householdId, householdId)
        )
      )
      .orderBy(desc(transactionGoalLinks.linkedAt));

    return rows.map((row) => ({
      ...row.link,
      transaction: row.transaction,
    }));
  }

  async getLinksForTransaction(transactionId: string, householdId: string) {
    const rows = await db
      .select({ link: transactionGoalLinks, goal: goals, tx: transactions })
      .from(transactionGoalLinks)
      .innerJoin(goals, eq(transactionGoalLinks.goalId, goals.id))
      .innerJoin(transactions, eq(transactionGoalLinks.transactionId, transactions.id))
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.householdId, householdId)
        )
      )
      .orderBy(desc(transactionGoalLinks.linkedAt));

    return rows.map((row) => ({
      ...row.link,
      goal: {
        id: row.goal.id,
        name: row.goal.name,
        type: row.goal.type,
        goalType: row.goal.goalType,
        icon: row.goal.icon,
        color: row.goal.color,
        customImageUrl: row.goal.customImageUrl,
        currency: row.goal.currency,
      },
    }));
  }
}

export const transactionGoalLinkService = new TransactionGoalLinkService();
