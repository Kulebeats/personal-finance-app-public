import type { Budget, InsertBudget } from "@shared/schema";
import { EventTypes, outboxEventService } from "../../core/events";
import { isCurrencyCode } from "@shared/denomination";
import { Money } from "../../core/money";
import { budgetRepository } from "../../repositories/BudgetRepository";
import { budgetQueryRepository, type BudgetProgressRow, type UnavailableBudget } from "../../repositories/BudgetQueryRepository";
import type { UnbudgetedSpend } from "../../repositories/BudgetUnbudgetedSpend";
import { assertBudgetReadContext, type BudgetReadContext } from "../../repositories/BudgetReadContext";
import { categoryRepository } from "../../repositories/CategoryRepository";
import { categoryGroupRepository } from "../../repositories/CategoryGroupRepository";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
// BUDGET-TIME-001: Import timezone-safe date utilities
import { getMonthStart, getMonthEnd } from "../../utils/dateUtils";
import { householdCalendarDate } from "@shared/household-calendar";
import { db } from "../../db";
import { calendarClock, householdCalendarZone } from "../householdCalendarToday";
import { insertAuditedBudget, type BudgetCreateActor, type BudgetMonth } from "./budgetCreate";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";
import { lockAccountHousehold } from "../../repositories/AccountCreationGrant";

const auditedBudget = (row: Budget) => ({
  name: row.name, amount: row.amount, period: row.period, categoryId: row.categoryId, isActive: row.isActive,
});

type BudgetAlert = {
  budget: Budget;
  spent: Money;
  percentUsed: number;
  alertLevel: "warning" | "alert" | "exceeded";
};

const MONTHLY_BUDGET_PERIOD = "monthly";
const UNSUPPORTED_BUDGET_PERIOD_MESSAGE =
  "Only monthly budgets are currently supported";
const MAX_PERSISTED_BUDGET_AMOUNT = "9999999999999.99";

function readPersistableBudgetMoney(amount: string, currency: string): Money {
  if (typeof amount !== "string" || !/^-?\d+(\.\d{1,2})?$/.test(amount)) {
    throw new ValidationError("Budget amounts must be finite decimal values with at most two decimal places");
  }
  const value = new Money(amount, currency);
  if (!value.amount.isFinite()) throw new ValidationError("Invalid budget amount");
  if (value.abs().gt(new Money(MAX_PERSISTED_BUDGET_AMOUNT, value.currency))) {
    throw new ValidationError("Budget amount exceeds supported range");
  }
  return value;
}

function validateSupportedBudgetPeriod(period: unknown): void {
  if (
    period !== undefined &&
    period !== null &&
    period !== MONTHLY_BUDGET_PERIOD
  ) {
    throw new ValidationError("Invalid budget period", [
      { field: "period", message: UNSUPPORTED_BUDGET_PERIOD_MESSAGE },
    ]);
  }
}

/**
 * BudgetService
 *
 * Business logic layer for budget operations.
 */
export class BudgetCoreService {
  /**
   * Get all budgets for a household
   */
  async getBudgets(
    householdId: string,
    options?: { includeInactive?: boolean },
  ): Promise<Budget[]> {
    return await budgetRepository.findByHousehold(householdId, options);
  }

  /**
   * Get a single budget by ID
   */
  async getBudgetById(id: string, householdId: string): Promise<Budget> {
    const budget = await budgetRepository.findById(id, householdId);

    if (!budget) {
      throw new NotFoundError("Budget not found");
    }

    return budget;
  }

  /**
   * Get budgets with calculated progress (spent amounts)
   */
  async getBudgetProgress(
    householdId: string,
    year: number,
    month: number,
    context: BudgetReadContext,
  ): Promise<
    Array<
      Budget & {
        amount: string;
        spent: Money;
        remaining: Money;
        percentUsed: number;
        rolloverIn: Money;
      }
    >
  > {
    assertBudgetReadContext(householdId, context);
    return await budgetQueryRepository.getBudgetsWithProgress(
      householdId,
      year,
      month,
      { context },
    );
  }

  /** Progress plus the budgets that cannot be reported in household currency. */
  async getBudgetProgressReport(
    householdId: string,
    year: number,
    month: number,
    context: BudgetReadContext,
  ): Promise<{ progress: BudgetProgressRow[]; unavailable: UnavailableBudget[]; unbudgeted: UnbudgetedSpend }> {
    assertBudgetReadContext(householdId, context);
    const projection = await budgetQueryRepository.getProgressProjection(householdId, year, month, { context });
    return { progress: projection.progress, unavailable: projection.unavailable, unbudgeted: projection.unbudgeted };
  }

  async processBudgetRollover(
    householdId: string,
    date: Date = calendarClock.now(),
  ): Promise<{ created: number; updated: number; total: number }> {
    // FIN-12 / NEW-16: the month this instant falls in on the household calendar
    // (its own zone, UTC for a legacy household), never the server UTC month.
    const today = householdCalendarDate(date, await householdCalendarZone(db, householdId));
    const year = Number.parseInt(today.slice(0, 4), 10);
    const month = Number.parseInt(today.slice(5, 7), 10);

    const startDate = getMonthStart(year, month);
    const endDate = getMonthEnd(year, month);

    // Get budget progress with rollover calculations (pure read, no side effects)
    const projection = await budgetQueryRepository.getProgressProjection(householdId, year, month,
      { context: { kind: "system", purpose: "budget-rollover", sharedOnly: true }, rolloverOnly: true });
    if (!projection.preferences.autoRolloverBudget) return { created: 0, updated: 0, total: 0 };
    const budgetProgresses = projection.progress;

    if (budgetProgresses.length === 0) {
      return { created: 0, updated: 0, total: 0 };
    }

    // Persist rollover data separately (write operation)
    const { created, updated } =
      await budgetRepository.persistBudgetPeriodRollovers(
        budgetProgresses,
        startDate,
        endDate,
        { refreshZero: true },
      );

    return { created, updated, total: created + updated };
  }

  /**
   * Create a new budget
   */
  async createBudget(
    data: Omit<InsertBudget, "householdId">,
    householdId: string,
    actor: BudgetCreateActor,
    onlyFor?: BudgetMonth,
  ): Promise<Budget> {
    // BUDGET-VAL-001: Validate amount - must be positive (defense in depth)
    if (data.amount === null || data.amount === undefined) throw new ValidationError("A recurring budget amount is required");
    validateSupportedBudgetPeriod(data.period);
    if (!isCurrencyCode(data.currency)) throw new ValidationError("A captured budget currency is required");
    const amountMoney = readPersistableBudgetMoney(data.amount, data.currency);
    if (amountMoney.isNegative() || amountMoney.isZero()) {
      throw new ValidationError("Invalid budget amount", [
        { field: "amount", message: "Must be a positive number (greater than zero)" },
      ]);
    }
    if (data.rolloverAmount !== undefined && data.rolloverAmount !== null) {
      readPersistableBudgetMoney(data.rolloverAmount, data.currency);
    }

    // Validate thresholds
    if (
      data.warningThreshold &&
      (data.warningThreshold < 0 || data.warningThreshold > 100)
    ) {
      throw new ValidationError("Invalid warning threshold", [
        { field: "warningThreshold", message: "Must be between 0 and 100" },
      ]);
    }
    // FIX-008: Defense in depth - alertThreshold max should be 100 (not 200)
    if (
      data.alertThreshold &&
      (data.alertThreshold < 0 || data.alertThreshold > 100)
    ) {
      throw new ValidationError("Invalid alert threshold", [
        { field: "alertThreshold", message: "Must be between 0 and 100" },
      ]);
    }

    // ISSUE-008: Validate category is not archived
    if (data.categoryId) {
      const category = await categoryRepository.findByIdAndHousehold(
        data.categoryId,
        householdId,
      );
      if (!category) {
        throw new NotFoundError("Category not found");
      }
      if (category.isArchived) {
        throw new ValidationError("Cannot create budget for archived category", [
          { field: "categoryId", message: "Category is archived" },
        ]);
      }
    }

    // ISSUE-008: Validate category group is not archived
    if (data.categoryGroupId) {
      const group = await categoryGroupRepository.findByIdAndHousehold(
        data.categoryGroupId,
        householdId,
      );
      if (!group) {
        throw new NotFoundError("Category group not found");
      }
      if (group.isArchived) {
        throw new ValidationError("Cannot create budget for archived category group", [
          { field: "categoryGroupId", message: "Category group is archived" },
        ]);
      }
    }

    // The budget and its audit row commit together; a month-only budget gets
    // that month's limit and no recurring default (A-16, A-23).
    const budget = await insertAuditedBudget({ ...data, amount: data.amount, householdId }, actor, onlyFor);

    logger.info("Budget created", { householdId });

    // Emit budget created event
    outboxEventService
      .publish({
        eventType: EventTypes.BUDGET_CREATED,
        aggregateType: "budget",
        aggregateId: budget.id,
        householdId,
        payload: { id: budget.id, name: budget.name, amount: budget.amount },
      })
      .catch((err) => logger.error("Failed to publish budget event", { err }));

    return budget;
  }

  /**
   * Update a budget. With an actor, the update and its one audit row commit in
   * one transaction under the budget row lock (NEW-32).
   */
  async updateBudget(
    id: string,
    data: Partial<Budget>,
    householdId: string,
    actor?: BudgetCreateActor,
  ): Promise<Budget> {
    const budget = await withTransaction(async (tx) => {
      // Household first, as the confirmed apply locks it (P1-1): the audit FK takes KEY SHARE on it.
      await lockAccountHousehold(tx, householdId);
      const existing = await budgetRepository.findById(id, householdId, tx, true);
      if (!existing) {
        throw new NotFoundError("Budget not found");
      }
      const updated = await this.writeBudgetUpdate(existing, data, tx);
      if (actor) {
        await businessAuditService.logUpdate({
          tx, userId: actor.userId, householdId, entityId: id, entityType: "budget",
          oldValue: auditedBudget(existing), newValue: auditedBudget(updated), ipAddress: actor.ipAddress,
        });
      }
      return updated;
    });

    logger.info("Budget updated", { householdId });

    // Emit budget updated event
    outboxEventService
      .publish({
        eventType: EventTypes.BUDGET_UPDATED,
        aggregateType: "budget",
        aggregateId: id,
        householdId,
        payload: { id, changes: Object.keys(data) },
      })
      .catch((err) => logger.error("Failed to publish budget event", { err }));

    return budget;
  }

  /** Validates a budget patch against the locked row, then writes it in tx. */
  private async writeBudgetUpdate(existing: Budget, data: Partial<Budget>, tx: TransactionType): Promise<Budget> {
    validateSupportedBudgetPeriod(data.period);

    // A money DTO changes the value in the existing denomination. It never
    // authorizes relabeling a recurring default, its periods or rollover.
    if (data.amount !== undefined || data.rolloverAmount !== undefined || data.currency !== undefined) {
      if (!isCurrencyCode(existing.currency) || (data.currency !== undefined && data.currency !== existing.currency)) {
        throw new ConflictError("Budget amount currency disagrees with the existing budget denomination");
      }
    }

    // BUDGET-VAL-001: Validate amount if provided - must be positive (defense in depth)
    if (data.amount !== undefined) {
      if (data.amount === null) throw new ValidationError("A recurring budget amount is required");
      const amountMoney = readPersistableBudgetMoney(data.amount, existing.currency);
      if (amountMoney.isNegative() || amountMoney.isZero()) {
        throw new ValidationError("Invalid budget amount", [
          { field: "amount", message: "Must be a positive number (greater than zero)" },
        ]);
      }
    }

    if (data.rolloverAmount !== undefined && data.rolloverAmount !== null) {
      readPersistableBudgetMoney(data.rolloverAmount, existing.currency);
    }

    const budget = await budgetRepository.update(existing.id, existing.householdId, data, tx);

    if (!budget) {
      throw new NotFoundError("Budget not found");
    }
    return budget;
  }

  /**
   * Delete a budget. With an actor, the delete and its one audit row commit in
   * one transaction under the budget row lock (NEW-32).
   */
  async deleteBudget(id: string, householdId: string, actor?: BudgetCreateActor): Promise<void> {
    await withTransaction(async (tx) => {
      // Household first, as the confirmed apply locks it (P1-1): the audit FK takes KEY SHARE on it.
      await lockAccountHousehold(tx, householdId);
      const existing = await budgetRepository.findById(id, householdId, tx, true);
      if (!existing || !(await budgetRepository.delete(id, householdId, tx))) {
        throw new NotFoundError("Budget not found");
      }
      if (actor) {
        await businessAuditService.logDelete({
          tx, userId: actor.userId, householdId, entityId: id, entityType: "budget",
          oldValue: { name: existing.name, amount: existing.amount, period: existing.period, categoryId: existing.categoryId },
          ipAddress: actor.ipAddress,
        });
      }
    });

    logger.info("Budget deleted", { householdId });

    // Emit budget deleted event
    outboxEventService
      .publish({
        eventType: EventTypes.BUDGET_DELETED,
        aggregateType: "budget",
        aggregateId: id,
        householdId,
        payload: { id },
      })
      .catch((err) => logger.error("Failed to publish budget event", { err }));
  }

  /**
   * Toggle budget active status
   */
  async toggleActive(
    id: string,
    householdId: string,
    isActive: boolean,
  ): Promise<Budget> {
    return await this.updateBudget(id, { isActive }, householdId);
  }

  /**
   * Get budget alerts (budgets near or over threshold)
   */
  async getBudgetAlerts(
    householdId: string,
    year: number,
    month: number,
    context: BudgetReadContext,
  ): Promise<BudgetAlert[]> {
    return (await this.getBudgetAlertsReport(householdId, year, month, context)).alerts;
  }

  /** Alerts plus the budgets that cannot be evaluated in household currency. */
  async getBudgetAlertsReport(
    householdId: string,
    year: number,
    month: number,
    context: BudgetReadContext,
  ): Promise<{ alerts: BudgetAlert[]; unavailable: UnavailableBudget[] }> {
    const projection = await budgetQueryRepository.getProgressProjection(householdId, year, month, { context });
    const householdWarningThreshold = projection.preferences.warningThreshold;
    const householdDangerThreshold = projection.preferences.alertThreshold;
    const budgetsWithProgress = projection.progress;

    const alerts: BudgetAlert[] = [];

    for (const b of budgetsWithProgress) {
      // Use budget-level threshold if set, otherwise fall back to household preference
      const warningThreshold = b.warningThreshold ?? householdWarningThreshold;
      const alertThreshold = b.alertThreshold ?? householdDangerThreshold;

      if (b.percentUsed >= 100) {
        alerts.push({
          budget: b,
          spent: b.spent,
          percentUsed: b.percentUsed,
          alertLevel: "exceeded",
        });
      } else if (b.percentUsed >= alertThreshold) {
        alerts.push({
          budget: b,
          spent: b.spent,
          percentUsed: b.percentUsed,
          alertLevel: "alert",
        });
      } else if (b.percentUsed >= warningThreshold) {
        alerts.push({
          budget: b,
          spent: b.spent,
          percentUsed: b.percentUsed,
          alertLevel: "warning",
        });
      }
    }

    return { alerts, unavailable: projection.unavailable };
  }
}
