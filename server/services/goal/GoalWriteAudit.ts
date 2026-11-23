import { and, eq } from "drizzle-orm";
import { goals, type Goal, type InsertGoal } from "@shared/schema";
import type { TransactionType } from "../../utils/withTransaction";
import { goalRepository } from "../../repositories/GoalRepository";
import { NotFoundError } from "../../utils/errorHandler";
import { lockAccountHousehold } from "../../repositories/AccountCreationGrant";
import { goalActivityLogService } from "../GoalActivityLogService";
import { businessAuditService } from "../BusinessAuditService";

/**
 * Request context for a goal write's business audit row. The row is written
 * through the write's own transaction, so a failing audit insert rolls the
 * write back instead of letting it commit unlogged (FIN-13, Rule 9).
 *
 * Every audited goal transaction takes the household row (KEY SHARE) before
 * any goal, assignment or account row: the audit insert's household FK needs
 * that lock, and erasure, accept-invite and ownership transfer take the
 * household FOR UPDATE before those rows, so taking it last could deadlock.
 */
export interface GoalAuditRequest {
  ipAddress?: string;
}

/** Inserts a goal with its activity entry and, for an audited caller, its CREATE row. */
export async function insertGoalWithAudit(
  tx: TransactionType, goal: InsertGoal, userId: string, audit?: GoalAuditRequest,
): Promise<Goal> {
  const created = await goalRepository.create(goal, tx);
  await goalActivityLogService.log({
    goalId: created.id,
    activityType: "goal_created",
    metadata: { initialTarget: created.targetAmount, initialDate: created.targetDate },
    createdBy: userId,
    tx,
  });
  if (audit) {
    await businessAuditService.logCreate({
      userId, householdId: created.householdId, entityId: created.id, entityType: "goal",
      newValue: { name: created.name, targetAmount: created.targetAmount },
      ipAddress: audit.ipAddress, tx,
    });
  }
  return created;
}

/** Deletes a locked goal and, for an audited caller, writes its DELETE row. */
export async function deleteGoalWithAudit(
  tx: TransactionType, id: string, householdId: string, audit?: GoalAuditRequest & { userId: string },
): Promise<void> {
  await lockAccountHousehold(tx, householdId);
  const [goal] = await tx.select().from(goals)
    .where(and(eq(goals.id, id), eq(goals.householdId, householdId))).for("update");
  if (!goal) throw new NotFoundError("Goal not found");
  await tx.delete(goals).where(and(eq(goals.id, id), eq(goals.householdId, householdId)));
  if (audit) {
    await businessAuditService.logDelete({
      userId: audit.userId, householdId, entityId: id, entityType: "goal",
      oldValue: { name: goal.name, targetAmount: goal.targetAmount, currentAmount: goal.currentAmount, type: goal.type },
      ipAddress: audit.ipAddress, tx,
    });
  }
}

interface AssignmentAuditSource {
  accountId: string;
  assignmentType: "full_balance" | "partial_balance";
  partialAmount: string | null;
  autoUpdate: boolean;
}

const assignmentValues = ({ accountId, assignmentType, partialAmount, autoUpdate }: AssignmentAuditSource) =>
  ({ accountId, assignmentType, partialAmount, autoUpdate });

/**
 * Writes the goal UPDATE row for an account assignment change inside that
 * change's transaction: `assignAccount` has only the new assignment,
 * `removeAssignment` only the old one.
 */
export async function logAssignmentAudit(tx: TransactionType, change: {
  goalId: string;
  householdId: string;
  userId: string;
  operation: "assignAccount" | "updateAssignment" | "removeAssignment";
  before?: AssignmentAuditSource;
  after?: AssignmentAuditSource;
  audit?: GoalAuditRequest;
}): Promise<void> {
  const { goalId, householdId, userId, operation, before, after, audit } = change;
  if (!audit) return;
  const accountId = (after ?? before)?.accountId;
  await businessAuditService.logUpdate({
    userId, householdId, entityId: goalId, entityType: "goal",
    oldValue: before ? assignmentValues(before) : undefined,
    newValue: after ? assignmentValues(after) : undefined,
    ipAddress: audit.ipAddress,
    metadata: operation === "assignAccount" ? { operation } : { operation, accountId },
    tx,
  });
}

/** Archives or unarchives a goal with its activity entry and, for an audited caller, its UPDATE row. */
export async function setGoalArchivedWithAudit(
  tx: TransactionType, id: string, householdId: string, userId: string, isArchived: boolean, audit?: GoalAuditRequest,
): Promise<Goal> {
  await lockAccountHousehold(tx, householdId);
  const goal = await goalRepository.update(id, householdId, { isArchived, archivedAt: isArchived ? new Date() : null }, tx);
  if (!goal) throw new NotFoundError("Goal not found");
  await goalActivityLogService.log({
    goalId: goal.id,
    activityType: isArchived ? "goal_archived" : "goal_unarchived",
    metadata: null,
    createdBy: userId,
    tx,
  });
  if (audit) {
    await businessAuditService.logUpdate({
      userId, householdId, entityId: id, entityType: "goal",
      newValue: { isArchived }, ipAddress: audit.ipAddress,
      metadata: { operation: isArchived ? "archiveGoal" : "unarchiveGoal" }, tx,
    });
  }
  return goal;
}
