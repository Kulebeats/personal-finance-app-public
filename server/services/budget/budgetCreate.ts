import type { Budget, InsertBudget } from "@shared/schema";
import { budgetRepository } from "../../repositories/BudgetRepository";
import { getMonthEnd, getMonthStart } from "../../utils/dateUtils";
import { withTransaction } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";

export interface BudgetCreateActor {
  readonly userId: string;
  readonly ipAddress?: string;
}

/** A calendar month a new budget's limit applies to, and only that month. */
export interface BudgetMonth {
  readonly year: number;
  readonly month: number;
}

/**
 * Writes an already validated budget and its CREATE audit row in one
 * transaction, so a failed audit insert leaves no budget behind (Rule 9, A-23).
 *
 * With `onlyFor`, the budget has no recurring default: the amount becomes that
 * month's limit only, written in the same transaction (A-16). Other months then
 * have no limit until one is set.
 */
export function insertAuditedBudget(data: InsertBudget & { amount: string }, actor: BudgetCreateActor,
  onlyFor?: BudgetMonth): Promise<Budget> {
  return withTransaction(async (tx) => {
    const budget = await budgetRepository.create(onlyFor ? { ...data, amount: null } : data, tx);
    const month = onlyFor
      ? { startDate: getMonthStart(onlyFor.year, onlyFor.month), endDate: getMonthEnd(onlyFor.year, onlyFor.month) }
      : undefined;
    if (month) {
      await budgetRepository.upsertPeriod({ budgetId: budget.id, ...month, budgetAmount: data.amount, currency: budget.currency }, tx);
    }
    await businessAuditService.logCreate({
      tx, userId: actor.userId, householdId: budget.householdId, entityType: "budget", entityId: budget.id,
      ipAddress: actor.ipAddress,
      newValue: { name: budget.name, amount: budget.amount, period: budget.period,
        ...(month ? { monthOnly: { ...month, amount: data.amount } } : {}) },
    });
    return budget;
  });
}
