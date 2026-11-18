/**
 * Goal Account Assignment Queries
 *
 * Read-only database queries for assignments and available funds.
 *
 * @module services/goal/assignment.queries
 */

import { db } from "../../db";
import {
  accounts,
  goalAccountAssignments,
  goals,
  type Goal,
} from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { accountRepository } from "../../repositories/AccountRepository";
import { Money } from "../../core/money";

/**
 * Get goal by ID with household validation
 */
export async function getGoal(
  goalId: string,
  householdId: string
): Promise<Goal> {
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
 * Get account by ID with household and visibility validation
 * FIX AUTH-GOAL-ASSIGN-001: Check visibility to prevent private account bypass
 */
export async function getAccount(
  accountId: string,
  householdId: string,
  userId: string
) {
  // Use repository method that respects privacy settings
  const account = await accountRepository.findByIdWithVisibility(
    accountId,
    householdId,
    userId
  );

  if (!account) {
    throw new ValidationError("Account not found or access denied", [
      {
        field: "accountId",
        message: "Account must belong to this household and be accessible",
      },
    ]);
  }

  return account;
}

/**
 * Get all assignments for a specific goal
 * FIX AUTH-GOAL-ASSIGN-001: Filter out private accounts not owned by requesting user
 */
export async function getAssignments(
  goalId: string,
  householdId: string,
  userId: string
) {
  const goal = await getGoal(goalId, householdId);

  const rows = await db
    .select({ assignment: goalAccountAssignments, account: accounts })
    .from(goalAccountAssignments)
    .innerJoin(accounts, eq(goalAccountAssignments.accountId, accounts.id))
    .where(eq(goalAccountAssignments.goalId, goal.id));

  // Filter out private accounts not owned by the requesting user
  return rows
    .filter(
      (row) => !row.account.isPrivate || row.account.ownerUserId === userId
    )
    .map((row) => ({
      ...row.assignment,
      accountName: row.account.name,
      accountBalance: row.account.balance,
      accountCurrency: row.account.currency,
      accountType: row.account.type,
    }));
}

/**
 * Get all assignments for a household (with goal info)
 * FIX AUTH-GOAL-ASSIGN-001: Filter out private accounts not owned by requesting user
 */
export async function getAssignmentsForHousehold(
  householdId: string,
  userId: string
) {
  const rows = await db
    .select({
      assignment: goalAccountAssignments,
      account: accounts,
      goal: goals,
    })
    .from(goalAccountAssignments)
    .innerJoin(accounts, eq(goalAccountAssignments.accountId, accounts.id))
    .innerJoin(goals, eq(goalAccountAssignments.goalId, goals.id))
    .where(eq(goals.householdId, householdId));

  // Filter out private accounts not owned by the requesting user
  return rows
    .filter(
      (row) => !row.account.isPrivate || row.account.ownerUserId === userId
    )
    .map((row) => ({
      ...row.assignment,
      accountName: row.account.name,
      accountBalance: row.account.balance,
      accountCurrency: row.account.currency,
      accountType: row.account.type,
      goalName: row.goal.name,
      goalType: row.goal.type,
      goalCurrency: row.goal.currency,
    }));
}

/**
 * Get available funds across all household accounts
 */
export async function getAvailableFunds(householdId: string, userId: string) {
  const householdAccounts =
    await accountRepository.findByHouseholdWithVisibility(
      householdId,
      userId,
      { includeArchived: false, includeHidden: false }
    );

  const assignments = await db
    .select({ assignment: goalAccountAssignments, goal: goals })
    .from(goalAccountAssignments)
    .innerJoin(goals, eq(goalAccountAssignments.goalId, goals.id))
    .where(eq(goals.householdId, householdId));

  const assignmentsByAccount = new Map<
    string,
    { type: "full_balance" | "partial_balance"; amount: Money }[]
  >();

  for (const row of assignments) {
    const amount = row.assignment.partialAmount
      ? new Money(row.assignment.partialAmount)
      : Money.zero();
    const list = assignmentsByAccount.get(row.assignment.accountId) ?? [];
    list.push({ type: row.assignment.assignmentType, amount });
    assignmentsByAccount.set(row.assignment.accountId, list);
  }

  return householdAccounts
    .filter((account) => account.isAsset)
    .map((account) => {
      const balanceMoney = new Money(account.balance);
      const assigned = assignmentsByAccount.get(account.id) ?? [];
      const hasFull = assigned.some((a) => a.type === "full_balance");
      const partialTotal = assigned.reduce(
        (sum, a) => sum.add(a.amount),
        Money.zero()
      );

      const assignedAmount = hasFull
        ? balanceMoney
        : partialTotal.gt(balanceMoney)
        ? balanceMoney
        : partialTotal;
      const availableAmount = balanceMoney.subtract(assignedAmount);

      return {
        accountId: account.id,
        accountName: account.name,
        balance: account.balance,
        currency: account.currency,
        assignedAmount: assignedAmount.toString(),
        availableAmount: availableAmount.isNegative()
          ? Money.zero().toString()
          : availableAmount.toString(),
      };
    });
}

/**
 * Get existing assignment by goal and account IDs
 */
export async function getExistingAssignment(goalId: string, accountId: string) {
  const [existing] = await db
    .select()
    .from(goalAccountAssignments)
    .where(
      and(
        eq(goalAccountAssignments.goalId, goalId),
        eq(goalAccountAssignments.accountId, accountId)
      )
    )
    .limit(1);

  return existing;
}
