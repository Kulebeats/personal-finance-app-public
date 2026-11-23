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
import { applyProgressAdjustment } from "./GoalProgressAdjustments";
import type { RefoldResult } from "./GoalProgressFold";

// Import extracted modules
import {
  getGoal,
  getAccount,
  getAssignments as queryAssignments,
  getVisibleAssignments as queryVisibleAssignments,
  getAssignmentsForHousehold as queryAssignmentsForHousehold,
  getAvailableFunds as queryAvailableFunds,
  getExistingAssignment,
  lockExistingAssignment,
} from "./assignment.queries";
import type { HouseholdContext } from "../../middleware/householdGuard";
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
import { hasCountedSources } from "./GoalProgressSources";
import { logAssignmentAudit, type GoalAuditRequest } from "./GoalWriteAudit";
import { lockAccountHousehold } from "../../repositories/AccountCreationGrant";
import { householdToday } from "../householdCalendarToday";

/** The assignment an update leaves: the requested fields over `current`. */
function nextAssignmentData(
  accountId: string, current: Omit<AssignmentData, "accountId">, data: Partial<AssignmentData>,
): AssignmentData {
  return {
    accountId,
    assignmentType: data.assignmentType ?? current.assignmentType,
    partialAmount: data.partialAmount !== undefined ? data.partialAmount : current.partialAmount,
    autoUpdate: data.autoUpdate !== undefined ? data.autoUpdate : current.autoUpdate,
  };
}

export class GoalAccountAssignmentService {
  // Delegate to queries module
  // FIX AUTH-GOAL-ASSIGN-001: Pass userId for privacy filtering
  async getAssignments(goalId: string, householdId: string, userId: string) {
    return queryAssignments(goalId, householdId, userId);
  }

  async getVisibleAssignments(goalId: string, actor: HouseholdContext) {
    return queryVisibleAssignments(goalId, actor);
  }

  async getAssignmentsForHousehold(actor: HouseholdContext) {
    return queryAssignmentsForHousehold(actor);
  }

  async getAvailableFunds(householdId: string, userId: string) {
    return queryAvailableFunds(householdId, userId);
  }

  async assignAccount(
    goalId: string,
    householdId: string,
    userId: string,
    data: AssignmentData,
    /** Request context for the goal's UPDATE audit row, written in the same transaction (FIN-13). */
    audit?: GoalAuditRequest,
  ) {
    const goal = await getGoal(goalId, householdId);
    // FIX AUTH-GOAL-ASSIGN-001: Pass userId for visibility check
    const account = await getAccount(data.accountId, householdId, userId);

    // Pure validation (no DB queries)
    validateAssignmentRules(goal, account, data);

    return await withTransaction(async (tx) => {
      // Household first: the audit FK lock order (FIN-13, see GoalWriteAudit).
      await lockAccountHousehold(tx, householdId);
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

      await logAssignmentAudit(tx, { goalId, householdId, userId, operation: "assignAccount", after: assignment, audit });
      return { assignment, goal: updatedGoal };
    });
  }

  async updateAssignment(
    goalId: string,
    accountId: string,
    householdId: string,
    userId: string,
    data: Partial<AssignmentData>,
    /** Request context for the goal's UPDATE audit row, written in the same transaction (FIN-13). */
    audit?: GoalAuditRequest,
  ) {
    const goal = await getGoal(goalId, householdId);
    // FIX AUTH-GOAL-ASSIGN-001: Pass userId for visibility check
    const account = await getAccount(accountId, householdId, userId);

    const existing = await getExistingAssignment(goalId, accountId);
    if (!existing) {
      throw new NotFoundError("Assignment not found");
    }

    // Pure validation (no DB queries); repeated on the locked row below.
    validateAssignmentRules(goal, account, nextAssignmentData(accountId, existing, data));

    return await withTransaction(async (tx) => {
      // Household first: the audit FK lock order (FIN-13, see GoalWriteAudit).
      await lockAccountHousehold(tx, householdId);
      // The row as committed when this write holds it: a change made while it
      // waited is what this write replaces, applies against, and audits.
      const locked = await lockExistingAssignment(tx, goalId, accountId);
      const nextData = nextAssignmentData(accountId, locked, data);
      validateAssignmentRules(goal, account, nextData);
      // Run constraint check inside transaction with FOR UPDATE locks
      await ensureAssignmentConstraints(goalId, account, nextData, locked, tx);

      const [updatedAssignment] = await tx
        .update(goalAccountAssignments)
        .set({
          assignmentType: nextData.assignmentType,
          partialAmount: nextData.partialAmount,
          autoUpdate:
            nextData.assignmentType === "full_balance" ? nextData.autoUpdate : false,
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
        locked
      );

      await logAssignmentAudit(tx, {
        goalId, householdId, userId, operation: "updateAssignment", before: locked, after: updatedAssignment, audit,
      });
      return { assignment: updatedAssignment, goal: updatedGoal };
    });
  }

  async removeAssignment(
    goalId: string,
    accountId: string,
    householdId: string,
    userId: string,
    /** Request context for the goal's UPDATE audit row, written in the same transaction (FIN-13). */
    audit?: GoalAuditRequest,
  ) {
    const goal = await getGoal(goalId, householdId);
    // FIX AUTH-GOAL-ASSIGN-001: Pass userId for visibility check
    const account = await getAccount(accountId, householdId, userId);

    return await withTransaction(async (tx) => {
      // Household first: the audit FK lock order (FIN-13, see GoalWriteAudit).
      await lockAccountHousehold(tx, householdId);
      // The row as committed when this removal holds it is what it releases and audits.
      const existing = await lockExistingAssignment(tx, goalId, accountId);
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

      await logAssignmentAudit(tx, { goalId, householdId, userId, operation: "removeAssignment", before: existing, audit });
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
      accountId: string;
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

    // R10.3: an auto-synced balance replaces progress, so it may not be added
    // on top of links or contributions the goal already counts.
    if (hasAutoSync && await hasCountedSources(tx, lockedGoal.id)) {
      throw new ConflictError(
        "This goal already counts linked transactions or contributions. Unlink or reverse them before assigning an auto-synced account."
      );
    }

    let partialChange: Money | null = null;
    if (hasAutoSync) {
      newBalanceMoney = await calculateAssignmentBalance(lockedGoal.id, tx);
    } else if (assignment.assignmentType === "partial_balance") {
      const nextPartial = assignment.partialAmount
        ? new Money(assignment.partialAmount, lockedGoal.currency)
        : Money.zero(lockedGoal.currency);
      const previousPartial =
        previousAssignment?.assignmentType === "partial_balance" &&
        previousAssignment.partialAmount
          ? new Money(previousAssignment.partialAmount, lockedGoal.currency)
          : Money.zero(lockedGoal.currency);
      partialChange = nextPartial.subtract(previousPartial);
    }

    const placed = await this.placePartialChange(tx, lockedGoal, assignment.accountId, partialChange, userId);
    if (placed) newBalanceMoney = placed.write.next;
    const newBalance = newBalanceMoney.toNumber();
    const previousBalance = previousBalanceMoney.toNumber();
    const update = buildGoalBalanceUpdate(lockedGoal, newBalanceMoney, await householdToday(tx, lockedGoal.householdId));

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
    // The audience is decided on this transaction (#235 R2-1); the send is not awaited.
    await notificationService.triggerGoalMilestone(
      lockedGoal.householdId, updatedGoal.id, updatedGoal.name, percentBefore, percentAfter, tx,
    );

    return updatedGoal;
  }

  /**
   * A partial-balance change is a progress adjustment at its own place in
   * the goal's applied order (GoalProgressAdjustments), so a later replay
   * keeps it after the sources that came before it.
   */
  private async placePartialChange(
    tx: TransactionType, goal: Goal, accountId: string, change: Money | null, userId: string,
  ): Promise<RefoldResult | null> {
    if (!change || change.isZero()) return null;
    // A release takes back what progress still holds of it, never refused (#235 M3).
    return applyProgressAdjustment(tx, goal, { kind: "assignment", amount: change, refId: accountId, createdBy: userId });
  }

  private async applyRemovalBalanceUpdate(
    tx: TransactionType,
    goal: Goal,
    assignment: {
      accountId: string;
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
        ? new Money(assignment.partialAmount, lockedGoal.currency)
        : Money.zero(lockedGoal.currency);
      // Released at the removal's own place in the applied order.
      const placed = await this.placePartialChange(tx, lockedGoal, assignment.accountId, deltaMoney.negated(), userId);
      if (placed) newBalanceMoney = placed.write.next;
    }

    const newBalance = newBalanceMoney.toNumber();
    const previousBalance = previousBalanceMoney.toNumber();
    const update = buildGoalBalanceUpdate(lockedGoal, newBalanceMoney, await householdToday(tx, lockedGoal.householdId));

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
    // The audience is decided on this transaction (#235 R2-1); the send is not awaited.
    await notificationService.triggerGoalMilestone(
      lockedGoal.householdId, updatedGoal.id, updatedGoal.name, percentBefore, percentAfter, tx,
    );

    return updatedGoal;
  }
}

export const goalAccountAssignmentService = new GoalAccountAssignmentService();
