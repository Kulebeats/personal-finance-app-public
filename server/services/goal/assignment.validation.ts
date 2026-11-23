/**
 * Goal Account Assignment Validation
 *
 * Pure validation functions for assignment rules and constraints.
 *
 * @module services/goal/assignment.validation
 */

import { type Goal, type GoalAccountAssignment } from "@shared/schema";
import { ValidationError } from "../../utils/errorHandler";
import { Money } from "../../core/money";
import { db } from "../../db";
import { goalAccountAssignments } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import type { TransactionType } from "../../utils/withTransaction";

export interface AssignmentData {
  accountId: string;
  assignmentType: "full_balance" | "partial_balance";
  partialAmount?: string | null;
  autoUpdate?: boolean;
}

export interface AccountInfo {
  id: string;
  currency: string;
  balance: string;
}

/**
 * Validate assignment business rules
 */
export function validateAssignmentRules(
  goal: Goal,
  account: AccountInfo,
  data: AssignmentData
): void {
  if (goal.type === "pay_down") {
    throw new ValidationError(
      "Pay Down goals use debtAccountId, not assignments"
    );
  }

  const usesHoldings =
    goal.type === "investment" && goal.progressSource === "holdings";

  if (usesHoldings && data.assignmentType !== "full_balance") {
    throw new ValidationError(
      "Investment goals tracked by holdings must use full balance assignments"
    );
  }

  if (!usesHoldings && account.currency !== goal.currency) {
    throw new ValidationError(
      `Account currency (${account.currency}) must match goal currency (${goal.currency})`
    );
  }

  if (data.assignmentType === "full_balance" && data.autoUpdate === false) {
    throw new ValidationError("Full balance assignments must auto-update");
  }

  if (
    goal.spendingReducesProgress &&
    data.assignmentType === "full_balance"
  ) {
    throw new ValidationError(
      "Cannot assign auto-synced accounts when spending reduces progress is enabled"
    );
  }

  if (data.assignmentType === "partial_balance") {
    if (!data.partialAmount) {
      throw new ValidationError(
        "Partial amount required for partial balance"
      );
    }
    const amount = new Money(data.partialAmount);
    if (amount.isNegativeOrZero()) {
      throw new ValidationError("Partial amount must be positive");
    }
    if (data.autoUpdate) {
      throw new ValidationError("Partial assignments cannot auto-update");
    }
  }
}

/**
 * Find existing full_balance assignment for an account
 * @param accountId - The account ID to check
 * @param tx - Optional transaction context for FOR UPDATE locking
 */
export async function findFullBalanceAssignment(
  accountId: string,
  tx?: TransactionType
) {
  const executor = tx ?? db;
  const query = executor
    .select()
    .from(goalAccountAssignments)
    .where(
      and(
        eq(goalAccountAssignments.accountId, accountId),
        eq(goalAccountAssignments.assignmentType, "full_balance")
      )
    )
    .orderBy(goalAccountAssignments.id)
    .limit(1);

  // Use FOR UPDATE lock when inside a transaction to prevent race conditions
  const [assignment] = tx ? await query.for("update") : await query;

  return assignment;
}

/**
 * Find all assignments for an account
 * @param accountId - The account ID to check
 * @param tx - Optional transaction context for FOR UPDATE locking
 */
export async function findAssignmentsByAccount(
  accountId: string,
  tx?: TransactionType
) {
  const executor = tx ?? db;
  const query = executor
    .select()
    .from(goalAccountAssignments)
    .where(eq(goalAccountAssignments.accountId, accountId))
    .orderBy(goalAccountAssignments.id);

  // FOR UPDATE inside a transaction, in id order so every writer locks the set the same way
  return tx ? await query.for("update") : await query;
}

/**
 * Get total partial amount assigned to an account
 * @param accountId - The account ID to check
 * @param excludeGoalId - Optional goal ID to exclude from total
 * @param tx - Optional transaction context for FOR UPDATE locking
 */
export async function getTotalPartialAssigned(
  accountId: string,
  excludeGoalId?: string,
  tx?: TransactionType
): Promise<Money> {
  const executor = tx ?? db;
  const query = executor
    .select()
    .from(goalAccountAssignments)
    .where(
      and(
        eq(goalAccountAssignments.accountId, accountId),
        eq(goalAccountAssignments.assignmentType, "partial_balance")
      )
    )
    .orderBy(goalAccountAssignments.id);

  // Use FOR UPDATE lock when inside a transaction to prevent race conditions
  const assignments = tx ? await query.for("update") : await query;

  return assignments.reduce((sum: Money, a: GoalAccountAssignment) => {
    if (excludeGoalId && a.goalId === excludeGoalId) return sum;
    if (!a.partialAmount) return sum;
    return sum.add(a.partialAmount);
  }, Money.zero());
}

/**
 * Ensure assignment constraints are met (uniqueness, balance limits)
 * @param goalId - The goal ID
 * @param account - Account info with id and balance
 * @param data - Assignment data
 * @param _existingAssignment - Existing assignment if updating
 * @param tx - Optional transaction context for FOR UPDATE locking (RECOMMENDED for concurrent safety)
 */
export async function ensureAssignmentConstraints(
  goalId: string,
  account: { id: string; balance: string },
  data: AssignmentData,
  _existingAssignment: {
    assignmentType: "full_balance" | "partial_balance";
    partialAmount: string | null;
  } | null,
  tx?: TransactionType
): Promise<void> {
  if (data.assignmentType === "full_balance") {
    // Pass transaction for FOR UPDATE lock to prevent race conditions
    const existingFull = await findFullBalanceAssignment(account.id, tx);
    if (existingFull && existingFull.goalId !== goalId) {
      throw new ValidationError(
        "Account already fully assigned to another goal"
      );
    }
  }

  // Pass transaction for FOR UPDATE lock to prevent race conditions
  const existingAssignments = await findAssignmentsByAccount(account.id, tx);
  const hasDifferentType = existingAssignments.some(
    (a: GoalAccountAssignment) => a.assignmentType !== data.assignmentType && a.goalId !== goalId
  );

  if (hasDifferentType) {
    throw new ValidationError(
      "Cannot mix full_balance and partial_balance for the same account"
    );
  }

  if (data.assignmentType === "partial_balance") {
    // Pass transaction for FOR UPDATE lock to prevent race conditions
    const totalAssigned = await getTotalPartialAssigned(
      account.id,
      goalId,
      tx
    );
    const newAmount = data.partialAmount
      ? new Money(data.partialAmount)
      : Money.zero();
    const available = new Money(account.balance).subtract(totalAssigned);
    if (newAmount.gt(available)) {
      throw new ValidationError(
        `Insufficient available balance. Available: ${available.toString()}`
      );
    }
  }
}
