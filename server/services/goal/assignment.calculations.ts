/**
 * Goal Account Assignment Calculations
 *
 * Balance calculations and holdings value computations.
 *
 * @module services/goal/assignment.calculations
 */

import { db } from "../../db";
import {
  accounts,
  goalAccountAssignments,
  goals,
  holdings,
  securities,
} from "@shared/schema";
import type { Goal } from "@shared/schema";
import { eq, inArray, and } from "drizzle-orm";
import { getLatestFxRates } from "../../core/calculations";
import { Money } from "../../core/money";
import { buildGoalBalanceUpdate } from "../goalCalculations";
import type { TransactionType } from "../../utils/withTransaction";

// Database executor - can be either the db instance or a transaction
export type DbExecutor = typeof db | TransactionType;

/**
 * Check if goal has at least one auto-sync (full_balance + autoUpdate) assignment
 */
export async function hasAutoSyncAssignments(
  goalId: string,
  tx?: TransactionType
): Promise<boolean> {
  const executor: DbExecutor = tx ?? db;
  const assignments = await executor
    .select()
    .from(goalAccountAssignments)
    .where(eq(goalAccountAssignments.goalId, goalId));

  return assignments.some(
    (assignment: (typeof assignments)[0]) =>
      assignment.assignmentType === "full_balance" && assignment.autoUpdate
  );
}

/**
 * Calculate the total balance from all account assignments for a goal
 */
export async function calculateAssignmentBalance(
  goalId: string,
  tx?: TransactionType
): Promise<Money> {
  const executor: DbExecutor = tx ?? db;
  const [goal] = await executor
    .select()
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);

  if (!goal) return Money.zero();
  const baseCurrency = goal.currency || "ZMW";

  const assignments = await executor
    .select()
    .from(goalAccountAssignments)
    .where(eq(goalAccountAssignments.goalId, goalId));

  const usesHoldings =
    goal.type === "investment" && goal.progressSource === "holdings";

  if (usesHoldings) {
    const accountIds = assignments.map(
      (a: (typeof assignments)[0]) => a.accountId
    );
    if (accountIds.length === 0 && goal.linkedAccountId) {
      accountIds.push(goal.linkedAccountId);
    }

    if (!accountIds.length) return Money.zero(baseCurrency);
    // FIX DATA-GOAL-005: Pass householdId for tenant isolation
    return await calculateHoldingsValue(
      accountIds,
      goal.currency || "ZMW",
      goal.householdId,
      executor
    );
  }

  if (!assignments.length) return Money.zero(baseCurrency);

  const fullBalanceAssignments = assignments.filter(
    (a: (typeof assignments)[0]) =>
      a.assignmentType === "full_balance" && a.autoUpdate
  );
  const partialAssignments = assignments.filter(
    (a: (typeof assignments)[0]) => a.assignmentType === "partial_balance"
  );

  const accountIds = fullBalanceAssignments.map(
    (a: (typeof fullBalanceAssignments)[0]) => a.accountId
  );
  const accountRows = accountIds.length
    ? await executor
        .select({ id: accounts.id, balance: accounts.balance })
        .from(accounts)
        .where(inArray(accounts.id, accountIds))
    : [];

  const fullBalanceTotal = accountRows.reduce(
    (sum: Money, row: { id: string; balance: string }) =>
      sum.add(row.balance),
    Money.zero(baseCurrency)
  );

  const partialTotal = partialAssignments.reduce(
    (sum: Money, assignment: (typeof partialAssignments)[0]) =>
      assignment.partialAmount ? sum.add(assignment.partialAmount) : sum,
    Money.zero(baseCurrency)
  );

  return fullBalanceTotal.add(partialTotal);
}

/**
 * Calculate total value of holdings across accounts with FX conversion
 * FIX DATA-GOAL-005: Added householdId filter for tenant isolation
 */
export async function calculateHoldingsValue(
  accountIds: string[],
  baseCurrency: string,
  householdId: string,
  executor: DbExecutor
): Promise<Money> {
  // FIX DATA-GOAL-005: Filter holdings by household to prevent cross-tenant access
  const holdingsRows = await executor
    .select({ holding: holdings, security: securities })
    .from(holdings)
    .innerJoin(securities, eq(holdings.securityId, securities.id))
    .where(
      and(
        inArray(holdings.accountId, accountIds),
        eq(holdings.householdId, householdId)
      )
    );

  const normalizedBase = (baseCurrency || "ZMW").toUpperCase();
  const currencies: string[] = Array.from(
    new Set(
      holdingsRows
        .map(({ security }: { security: { currency?: string } }) =>
          (security.currency || normalizedBase).toUpperCase()
        )
        .filter((currency: string) => currency !== normalizedBase)
    )
  );

  // Use centralized calculation engine for FX rates
  const fxRatesByCurrency = await getLatestFxRates(currencies, normalizedBase);

  let totalValue = Money.zero(normalizedBase);
  for (const { holding, security } of holdingsRows) {
    const currency = (security.currency || normalizedBase).toUpperCase();
    const quantity = parseFloat(holding.quantity ?? "0"); // Quantity is share count, not currency
    const price = new Money(security.currentPrice ?? "0");
    const localValue = price.multiply(quantity);
    const fxRate =
      currency === normalizedBase
        ? 1
        : fxRatesByCurrency.get(currency) ??
          (holding.acquisitionFxRate
            ? parseFloat(String(holding.acquisitionFxRate))
            : 1);
    totalValue = totalValue.add(localValue.multiply(fxRate));
  }

  return totalValue;
}

/**
 * Check if a goal balance update has meaningful changes
 */
export function hasBalanceUpdate(
  goal: Goal,
  update: ReturnType<typeof buildGoalBalanceUpdate>
): boolean {
  const amountChanged = new Money(goal.currentAmount)
    .subtract(update.currentAmount)
    .abs()
    .gt(0.005);

  const projectionChanged =
    (goal.monthlyProjection === null) !== (update.monthlyProjection === null) ||
    (goal.monthlyProjection !== null &&
      update.monthlyProjection !== null &&
      new Money(goal.monthlyProjection)
        .subtract(update.monthlyProjection)
        .abs()
        .gt(0.005));

  const projectedDateChanged =
    String(goal.projectedCompletionDate ?? "") !==
    String(update.projectedCompletionDate ?? "");

  const statusChanged = update.status !== goal.status;
  const completionChanged = update.isCompleted !== goal.isCompleted;

  return (
    amountChanged ||
    projectionChanged ||
    projectedDateChanged ||
    statusChanged ||
    completionChanged
  );
}
