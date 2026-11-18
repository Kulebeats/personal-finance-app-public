/**
 * Goal Account Assignment Service
 *
 * CRUD operations for goal-account assignments with transaction support.
 * Uses extracted validation, calculations, and queries modules.
 *
 * @module services/goal/assignment.service
 */

import {
  goalAccountAssignments,
  goals,
  type Goal,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { NotFoundError, ConflictError } from "../../utils/errorHandler";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { goalActivityLogService } from "../GoalActivityLogService";
import { notificationService } from "../NotificationService";
import {
  buildGoalBalanceUpdate,
  calculatePercentComplete,
} from "../goalCalculations";
import { Money } from "../../core/money";

// Import extracted modules
import {
  getGoal,
  getAccount,
  getAssignments as queryAssignments,
  getAssignmentsForHousehold as queryAssignmentsForHousehold,
  getAvailableFunds as queryAvailableFunds,
  getExistingAssignment,
} from "./assignment.queries";
import {
  validateAssignmentRules,
  ensureAssignmentConstraints,
  type AssignmentData,
} from "./assignment.validation";
import {
  hasAutoSyncAssignments,
  calculateAssignmentBalance,
} from "./assignment.calculations";
import { syncGoalsForAccount as doSyncGoalsForAccount } from "./assignment.sync";

export class GoalAccountAssignmentService {
  // Delegate to queries module
  // FIX AUTH-GOAL-ASSIGN-001: Pass userId for privacy filtering
  async getAssignments(goalId: string, householdId: string, userId: string) {
    return queryAssignments(goalId, householdId, userId);
  }

  async getAssignmentsForHousehold(householdId: string, userId: string) {
    return queryAssignmentsForHousehold(householdId, userId);
  }

  async getAvailableFunds(householdId: string, userId: string) {
    return queryAvailableFunds(householdId, userId);
  }

  async assignAccount(
    goalId: string,
    householdId: string,
    userId: string,
    data: AssignmentData
  ) {
    const goal = await getGoal(goalId, householdId);
    // FIX AUTH-GOAL-ASSIGN-001: Pass userId for visibility check
    const account = await getAccount(data.accountId, householdId, userId);

    // Pure validation (no DB queries)
    validateAssignmentRules(goal, account, data);

    return await withTransaction(async (tx) => {
      // Run constraint check inside transaction with FOR UPDATE locks
      await ensureAssignmentConstraints(goalId, account, data, null, tx);

      // FIX DATA-GOAL-004: Check for duplicate inside transaction to prevent race condition
      const [existing] = await tx
        .select()
        .from(goalAccountAssignments)
        .where(
          and(
            eq(goalAccountAssignments.goalId, goalId),
            eq(goalAccountAssignments.accountId, data.accountId)
          )
        )
        .for("update") // Lock row to prevent concurrent inserts
        .limit(1);

      if (existing) {
        throw new ConflictError(
          "Assignment already exists for this goal and account"
        );
      }

      const [assignment] = await tx
        .insert(goalAccountAssignments)
        .values({
          goalId,
          accountId: data.accountId,
          assignmentType: data.assignmentType,
          partialAmount: data.partialAmount ?? null,
          autoUpdate:
            data.assignmentType === "full_balance"
              ? data.autoUpdate ?? true
              : false,
        })
        .returning();

      const updatedGoal = await this.applyAssignmentBalanceUpdate(
        tx,
        goal,
        assignment,
        userId,
        "account_assigned",
        {
          accountId: account.id,
          accountName: account.name,
          assignmentType: assignment.assignmentType,
        },
        null
      );

      return { assignment, goal: updatedGoal };
    });
  }

  async updateAssignment(
    goalId: string,
    accountId: string,
    householdId: string,
    userId: string,
    data: Partial<AssignmentData>
  ) {
    const goal = await getGoal(goalId, householdId);
    // FIX AUTH-GOAL-ASSIGN-001: Pass userId for visibility check
    const account = await getAccount(accountId, householdId, userId);

    const existing = await getExistingAssignment(goalId, accountId);
    if (!existing) {
      throw new NotFoundError("Assignment not found");
    }

    const nextAssignmentType = data.assignmentType ?? existing.assignmentType;
    const nextPartialAmount =
      data.partialAmount !== undefined
        ? data.partialAmount
        : existing.partialAmount;
    const nextAutoUpdate =
      data.autoUpdate !== undefined ? data.autoUpdate : existing.autoUpdate;

    const nextData: AssignmentData = {
      accountId,
      assignmentType: nextAssignmentType,
      partialAmount: nextPartialAmount,
      autoUpdate: nextAutoUpdate,
    };

    // Pure validation (no DB queries)
    validateAssignmentRules(goal, account, nextData);

    return await withTransaction(async (tx) => {
      // Run constraint check inside transaction with FOR UPDATE locks
      await ensureAssignmentConstraints(goalId, account, nextData, existing, tx);

      const [updatedAssignment] = await tx
        .update(goalAccountAssignments)
        .set({
          assignmentType: nextAssignmentType,
          partialAmount: nextPartialAmount,
          autoUpdate:
            nextAssignmentType === "full_balance" ? nextAutoUpdate : false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(goalAccountAssignments.goalId, goalId),
            eq(goalAccountAssignments.accountId, accountId)
          )
        )
        .returning();

      const updatedGoal = await this.applyAssignmentBalanceUpdate(
        tx,
        goal,
        updatedAssignment,
        userId,
        "account_assigned",
        {
          accountId: account.id,
          accountName: account.name,
          assignmentType: updatedAssignment.assignmentType,
        },
        existing
      );

      return { assignment: updatedAssignment, goal: updatedGoal };
    });
  }

  async removeAssignment(
    goalId: string,
    accountId: string,
    householdId: string,
    userId: string
  ) {
    const goal = await getGoal(goalId, householdId);
    // FIX AUTH-GOAL-ASSIGN-001: Pass userId for visibility check
    const account = await getAccount(accountId, householdId, userId);

    const existing = await getExistingAssignment(goalId, accountId);
    if (!existing) {
      throw new NotFoundError("Assignment not found");
    }

    return await withTransaction(async (tx) => {
      await tx
        .delete(goalAccountAssignments)
        .where(
          and(
            eq(goalAccountAssignments.goalId, goalId),
            eq(goalAccountAssignments.accountId, accountId)
          )
        );

      const updatedGoal = await this.applyRemovalBalanceUpdate(
        tx,
        goal,
        existing,
        userId,
        { accountId: account.id, accountName: account.name }
      );

      return { success: true, goal: updatedGoal };
    });
  }

  async syncGoalsForAccount(accountId: string, trigger: string) {
    return doSyncGoalsForAccount(accountId, trigger);
  }

  private async applyAssignmentBalanceUpdate(
    tx: TransactionType,
    goal: Goal,
    assignment: {
      assignmentType: "full_balance" | "partial_balance";
      partialAmount: string | null;
      autoUpdate: boolean;
    },
    userId: string,
    activityType: "account_assigned",
    metadata: Record<string, unknown>,
    previousAssignment?: {
      assignmentType: "full_balance" | "partial_balance";
      partialAmount: string | null;
    } | null
  ) {
    // Re-fetch goal with FOR UPDATE lock to prevent concurrent modifications
    // CRITICAL: This ensures we have the latest balance when calculating updates
    const [lockedGoal] = await tx
      .select()
      .from(goals)
      .where(eq(goals.id, goal.id))
      .for("update")
      .limit(1);

    if (!lockedGoal) {
      throw new NotFoundError("Goal not found");
    }

    const previousBalanceMoney = new Money(lockedGoal.currentAmount);

    const hasAutoSync = await hasAutoSyncAssignments(lockedGoal.id, tx);
    let newBalanceMoney = previousBalanceMoney;

    if (hasAutoSync) {
      newBalanceMoney = await calculateAssignmentBalance(lockedGoal.id, tx);
    } else if (assignment.assignmentType === "partial_balance") {
      const nextPartial = assignment.partialAmount
        ? new Money(assignment.partialAmount)
        : Money.zero();
      const previousPartial =
        previousAssignment?.assignmentType === "partial_balance" &&
        previousAssignment.partialAmount
          ? new Money(previousAssignment.partialAmount)
          : Money.zero();
      newBalanceMoney = previousBalanceMoney.add(
        nextPartial.subtract(previousPartial)
      );
    }

    const newBalance = newBalanceMoney.toNumber();
    const previousBalance = previousBalanceMoney.toNumber();
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
      .where(eq(goals.id, lockedGoal.id))
      .returning();

    await goalActivityLogService.log({
      goalId: lockedGoal.id,
      activityType,
      amount: null,
      previousBalance,
      newBalance,
      metadata,
      createdBy: userId,
      tx,
    });

    const percentBefore = calculatePercentComplete(lockedGoal, previousBalance);
    const percentAfter = calculatePercentComplete(lockedGoal, newBalance);
    notificationService
      .triggerGoalMilestone(
        lockedGoal.householdId,
        updatedGoal.id,
        updatedGoal.name,
        percentBefore,
        percentAfter
      )
      .catch(() => undefined);

    return updatedGoal;
  }

  private async applyRemovalBalanceUpdate(
    tx: TransactionType,
    goal: Goal,
    assignment: {
      assignmentType: "full_balance" | "partial_balance";
      partialAmount: string | null;
    },
    userId: string,
    metadata: Record<string, unknown>
  ) {
    // Re-fetch goal with FOR UPDATE lock to prevent concurrent modifications
    // CRITICAL: This ensures we have the latest balance when calculating updates
    const [lockedGoal] = await tx
      .select()
      .from(goals)
      .where(eq(goals.id, goal.id))
      .for("update")
      .limit(1);

    if (!lockedGoal) {
      throw new NotFoundError("Goal not found");
    }

    // Keep calculations in Money class to avoid floating point errors
    const previousBalanceMoney = new Money(lockedGoal.currentAmount);

    const hasAutoSync = await hasAutoSyncAssignments(lockedGoal.id, tx);
    let newBalanceMoney = previousBalanceMoney;

    if (hasAutoSync) {
      newBalanceMoney = await calculateAssignmentBalance(lockedGoal.id, tx);
    } else if (assignment.assignmentType === "partial_balance") {
      const deltaMoney = assignment.partialAmount
        ? new Money(assignment.partialAmount)
        : Money.zero();
      const subtracted = previousBalanceMoney.subtract(deltaMoney);
      newBalanceMoney = subtracted.isNegative() ? Money.zero() : subtracted;
    }

    const newBalance = newBalanceMoney.toNumber();
    const previousBalance = previousBalanceMoney.toNumber();
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
      .where(eq(goals.id, lockedGoal.id))
      .returning();

    await goalActivityLogService.log({
      goalId: lockedGoal.id,
      activityType: "account_unassigned",
      amount: null,
      previousBalance,
      newBalance,
      metadata,
      createdBy: userId,
      tx,
    });

    const percentBefore = calculatePercentComplete(lockedGoal, previousBalance);
    const percentAfter = calculatePercentComplete(lockedGoal, newBalance);
    notificationService
      .triggerGoalMilestone(
        lockedGoal.householdId,
        updatedGoal.id,
        updatedGoal.name,
        percentBefore,
        percentAfter
      )
      .catch(() => undefined);

    return updatedGoal;
  }
}

export const goalAccountAssignmentService = new GoalAccountAssignmentService();
