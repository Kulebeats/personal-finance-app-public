import type { Budget, InsertBudget } from "@shared/schema";
import { EventTypes, outboxEventService } from "../../core/events";
import { Money } from "../../core/money";
import { budgetRepository } from "../../repositories/BudgetRepository";
import { budgetQueryRepository } from "../../repositories/BudgetQueryRepository";
import { categoryRepository } from "../../repositories/CategoryRepository";
import { categoryGroupRepository } from "../../repositories/CategoryGroupRepository";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
// BUDGET-TIME-001: Import timezone-safe date utilities
import { getMonthStart, getMonthEnd } from "../../utils/dateUtils";

const MONTHLY_BUDGET_PERIOD = "monthly";
const UNSUPPORTED_BUDGET_PERIOD_MESSAGE =
  "Only monthly budgets are currently supported";

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
  ): Promise<
    Array<
      Budget & {
        spent: Money;
        remaining: Money;
        percentUsed: number;
        rolloverIn: Money;
      }
    >
  > {
    // FIX-006: Fetch household to get currency
    const household = await householdRepository.findById(householdId);
    const currency = household?.currency || "ZMW";

    const preferences = await householdRepository.findPreferences(householdId);
    const autoRolloverBudget = preferences?.autoRolloverBudget ?? false;
    const rolloverPercentage = preferences?.rolloverPercentage ?? 100;

    return await budgetQueryRepository.getBudgetsWithProgress(
      householdId,
      year,
      month,
      { autoRolloverBudget, rolloverPercentage, currency },
    );
  }

  async processBudgetRollover(
    householdId: string,
    date: Date = new Date(),
  ): Promise<{ created: number; updated: number; total: number }> {
    const preferences = await householdRepository.findPreferences(householdId);
    if (!preferences?.autoRolloverBudget) {
      return { created: 0, updated: 0, total: 0 };
    }

    // FIX-006: Also fetch household currency for rollover
    const household = await householdRepository.findById(householdId);
    const currency = household?.currency || "ZMW";

    // BUDGET-TIME-001: Use UTC to avoid timezone issues
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;

    const startDate = getMonthStart(year, month);
    const endDate = getMonthEnd(year, month);

    // Get budget progress with rollover calculations (pure read, no side effects)
    const budgetProgresses = await budgetQueryRepository.getBudgetsWithProgress(
      householdId,
      year,
      month,
      {
        autoRolloverBudget: true,
        rolloverPercentage: preferences?.rolloverPercentage ?? 100,
        currency,
      },
    );

    if (budgetProgresses.length === 0) {
      return { created: 0, updated: 0, total: 0 };
    }

    // Persist rollover data separately (write operation)
    const { created, updated } =
      await budgetRepository.persistBudgetPeriodRollovers(
        budgetProgresses,
        startDate,
        endDate,
      );

    return { created, updated, total: created + updated };
  }

  /**
   * Create a new budget
   */
  async createBudget(
    data: Omit<InsertBudget, "householdId">,
    householdId: string,
  ): Promise<Budget> {
    // BUDGET-VAL-001: Validate amount - must be positive (defense in depth)
    const amountMoney = new Money(data.amount);
    if (amountMoney.isNegative() || amountMoney.isZero()) {
      throw new ValidationError("Invalid budget amount", [
        { field: "amount", message: "Must be a positive number (greater than zero)" },
      ]);
    }

    validateSupportedBudgetPeriod(data.period);

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

    const budget = await budgetRepository.create({
      ...data,
      householdId,
    });

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
   * Update a budget
   */
  async updateBudget(
    id: string,
    data: Partial<Budget>,
    householdId: string,
  ): Promise<Budget> {
    // Verify exists
    const existing = await budgetRepository.findById(id, householdId);
    if (!existing) {
      throw new NotFoundError("Budget not found");
    }

    validateSupportedBudgetPeriod(data.period);

    // BUDGET-VAL-001: Validate amount if provided - must be positive (defense in depth)
    if (data.amount !== undefined) {
      const amountMoney = new Money(data.amount);
      if (amountMoney.isNegative() || amountMoney.isZero()) {
        throw new ValidationError("Invalid budget amount", [
          { field: "amount", message: "Must be a positive number (greater than zero)" },
        ]);
      }
    }

    const budget = await budgetRepository.update(id, householdId, data);

    if (!budget) {
      throw new NotFoundError("Budget not found");
    }

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

    // Note: Audit logging handled by controller (budgets.controller.ts)

    return budget;
  }

  /**
   * Delete a budget
   */
  async deleteBudget(id: string, householdId: string): Promise<void> {
    const deleted = await budgetRepository.delete(id, householdId);

    if (!deleted) {
      throw new NotFoundError("Budget not found");
    }

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
  ): Promise<
    Array<{
      budget: Budget;
      spent: Money;
      percentUsed: number;
      alertLevel: "warning" | "alert" | "exceeded";
    }>
  > {
    // ISSUE-012: Fetch household preferences for configurable thresholds
    const preferences = await householdRepository.findPreferences(householdId);
    const householdWarningThreshold = preferences?.budgetWarningThreshold ?? 75;
    const householdDangerThreshold = preferences?.budgetDangerThreshold ?? 90;

    const budgetsWithProgress = await this.getBudgetProgress(
      householdId,
      year,
      month,
    );

    const alerts: Array<{
      budget: Budget;
      spent: Money;
      percentUsed: number;
      alertLevel: "warning" | "alert" | "exceeded";
    }> = [];

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

    return alerts;
  }
}
