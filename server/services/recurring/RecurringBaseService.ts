import { accountRepository } from "../../repositories/AccountRepository";
import { categoryRepository } from "../../repositories/CategoryRepository";
import { merchantRepository } from "../../repositories/MerchantRepository";
import { recurringRepository } from "../../repositories/RecurringRepository";
import type { InsertRecurringTransaction, RecurringTransaction } from "@shared/schema";
import { EventTypes, outboxEventService } from "../../core/events";
import { Money } from "../../core/money";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";

export class RecurringBaseService {
  /**
   * Get all recurring rules for a household
   */
  async getRecurringRules(
    householdId: string,
    options?: { includeInactive?: boolean; includePaused?: boolean }
  ): Promise<RecurringTransaction[]> {
    return await recurringRepository.findByHousehold(householdId, options);
  }

  /**
   * Get a single recurring rule by ID
   */
  async getRecurringById(
    id: string,
    householdId: string
  ): Promise<RecurringTransaction> {
    const rule = await recurringRepository.findById(id, householdId);

    if (!rule) {
      throw new NotFoundError("Recurring rule not found");
    }

    return rule;
  }

  /**
   * Get upcoming bills within X days
   */
  async getUpcomingBills(
    householdId: string,
    withinDays: number = 14
  ): Promise<RecurringTransaction[]> {
    return await recurringRepository.findUpcoming(householdId, withinDays);
  }

  /**
   * Create a new recurring rule
   */
  async createRecurring(
    data: Omit<InsertRecurringTransaction, "householdId">,
    householdId: string,
    userId: string
  ): Promise<RecurringTransaction> {
    // Validate amount
    const amountMoney = new Money(data.amount);
    if (amountMoney.isNegative() || amountMoney.isZero()) {
      throw new ValidationError("Invalid amount", [
        { field: "amount", message: "Must be a positive number" },
      ]);
    }

    // Validate frequency
    const validFrequencies = [
      "daily",
      "weekly",
      "biweekly",
      "monthly",
      "quarterly",
      "semi_annually",
      "annually",
      "yearly",
      "custom",
    ];
    if (!validFrequencies.includes(data.frequency)) {
      throw new ValidationError("Invalid frequency", [
        { field: "frequency", message: `Must be one of: ${validFrequencies.join(", ")}` },
      ]);
    }

    if (data.frequency === "custom") {
      if (!data.intervalUnit || !data.intervalValue) {
        throw new ValidationError("Custom frequency requires interval values", [
          { field: "intervalUnit", message: "Required for custom frequency" },
        ]);
      }
    }

    // Validate account exists AND is visible to user
    const account = await accountRepository.findByIdWithVisibility(
      data.accountId,
      householdId,
      userId // Fixed: Use actual userId, not accountId
    );
    if (!account) {
      throw new NotFoundError("Account not found or not accessible");
    }

    // Validate next due date
    if (!data.nextDueDate) {
      throw new ValidationError("Next due date is required", [
        { field: "nextDueDate", message: "Must be a valid date" },
      ]);
    }

    // FIX DATA-REC-001: Validate category and merchant belong to household
    if (data.categoryId) {
      const category = await categoryRepository.findByIdAndHousehold(
        data.categoryId,
        householdId
      );
      if (!category) {
        throw new NotFoundError("Category not found");
      }
    }

    if (data.merchantId) {
      const merchant = await merchantRepository.findByIdAndHousehold(
        data.merchantId,
        householdId
      );
      if (!merchant) {
        throw new NotFoundError("Merchant not found");
      }
    }

    const rule = await recurringRepository.create({
      ...data,
      householdId,
    });

    logger.info("Recurring rule created", { householdId });

    // Emit recurring created event
    outboxEventService
      .publish({
        eventType: EventTypes.RECURRING_CREATED,
        aggregateType: "recurring",
        aggregateId: rule.id,
        householdId,
        payload: { id: rule.id, name: rule.name, frequency: rule.frequency },
      })
      .catch((err) =>
        logger.error("Failed to publish recurring event", { err })
      );

    await recurringRepository.logHistory({
      recurringTransactionId: rule.id,
      action: "created",
      newState: rule,
      performedBy: userId,
    });

    return rule;
  }

  /**
   * Update a recurring rule
   */
  async updateRecurring(
    id: string,
    data: Partial<RecurringTransaction>,
    householdId: string,
    userId?: string
  ): Promise<RecurringTransaction> {
    // Verify exists
    const existing = await recurringRepository.findById(id, householdId);
    if (!existing) {
      throw new NotFoundError("Recurring rule not found");
    }

    // Validate amount if provided
    if (data.amount !== undefined) {
      const amountMoney = new Money(data.amount);
      if (amountMoney.isNegative() || amountMoney.isZero()) {
        throw new ValidationError("Invalid amount", [
          { field: "amount", message: "Must be a positive number" },
        ]);
      }
    }

    if (data.frequency === "custom") {
      const intervalUnit = data.intervalUnit ?? existing.intervalUnit;
      const intervalValue = data.intervalValue ?? existing.intervalValue;
      if (!intervalUnit || !intervalValue) {
        throw new ValidationError("Custom frequency requires interval values", [
          { field: "intervalUnit", message: "Required for custom frequency" },
        ]);
      }
    }

    // FIX AUTH-REC-001: Validate account ownership if accountId is being changed
    if (data.accountId !== undefined && userId) {
      const account = await accountRepository.findByIdWithVisibility(
        data.accountId,
        householdId,
        userId
      );
      if (!account) {
        throw new NotFoundError("Account not found");
      }
    }

    // FIX DATA-REC-001: Validate category and merchant belong to household if being changed
    if (data.categoryId !== undefined && data.categoryId !== null) {
      const category = await categoryRepository.findByIdAndHousehold(
        data.categoryId,
        householdId
      );
      if (!category) {
        throw new NotFoundError("Category not found");
      }
    }

    if (data.merchantId !== undefined && data.merchantId !== null) {
      const merchant = await merchantRepository.findByIdAndHousehold(
        data.merchantId,
        householdId
      );
      if (!merchant) {
        throw new NotFoundError("Merchant not found");
      }
    }

    const rule = await recurringRepository.update(id, householdId, data);

    if (!rule) {
      throw new NotFoundError("Recurring rule not found");
    }

    logger.info("Recurring rule updated", { householdId });

    // Emit recurring updated event
    outboxEventService
      .publish({
        eventType: EventTypes.RECURRING_UPDATED,
        aggregateType: "recurring",
        aggregateId: id,
        householdId,
        payload: { id, changes: Object.keys(data) },
      })
      .catch((err) =>
        logger.error("Failed to publish recurring event", { err })
      );

    await recurringRepository.logHistory({
      recurringTransactionId: rule.id,
      action: "updated",
      previousState: existing,
      newState: rule,
      performedBy: userId,
    });

    return rule;
  }

  /**
   * Delete a recurring rule
   */
  async deleteRecurring(id: string, householdId: string): Promise<void> {
    const deleted = await recurringRepository.delete(id, householdId);

    if (!deleted) {
      throw new NotFoundError("Recurring rule not found");
    }

    logger.info("Recurring rule deleted", { householdId });

    // Emit recurring deleted event
    outboxEventService
      .publish({
        eventType: EventTypes.RECURRING_DELETED,
        aggregateType: "recurring",
        aggregateId: id,
        householdId,
        payload: { id },
      })
      .catch((err) =>
        logger.error("Failed to publish recurring event", { err })
      );
  }

  /**
   * Pause a recurring rule
   */
  async pauseRecurring(
    id: string,
    householdId: string,
    userId?: string
  ): Promise<RecurringTransaction> {
    const existing = await recurringRepository.findById(id, householdId);
    if (!existing) {
      throw new NotFoundError("Recurring rule not found");
    }

    const rule = await recurringRepository.pause(id, householdId);

    if (!rule) {
      throw new NotFoundError("Recurring rule not found");
    }

    logger.info("Recurring rule paused", { householdId });

    // Emit recurring paused event
    outboxEventService
      .publish({
        eventType: EventTypes.RECURRING_PAUSED,
        aggregateType: "recurring",
        aggregateId: id,
        householdId,
        payload: { id },
      })
      .catch((err) =>
        logger.error("Failed to publish recurring event", { err })
      );

    await recurringRepository.logHistory({
      recurringTransactionId: rule.id,
      action: "paused",
      previousState: existing,
      newState: rule,
      performedBy: userId,
    });

    return rule;
  }

  /**
   * Resume a recurring rule
   */
  async resumeRecurring(
    id: string,
    householdId: string,
    userId?: string
  ): Promise<RecurringTransaction> {
    const existing = await recurringRepository.findById(id, householdId);
    if (!existing) {
      throw new NotFoundError("Recurring rule not found");
    }

    const rule = await recurringRepository.resume(id, householdId);

    if (!rule) {
      throw new NotFoundError("Recurring rule not found");
    }

    logger.info("Recurring rule resumed", { householdId });

    // Emit recurring resumed event
    outboxEventService
      .publish({
        eventType: EventTypes.RECURRING_RESUMED,
        aggregateType: "recurring",
        aggregateId: id,
        householdId,
        payload: { id },
      })
      .catch((err) =>
        logger.error("Failed to publish recurring event", { err })
      );

    await recurringRepository.logHistory({
      recurringTransactionId: rule.id,
      action: "resumed",
      previousState: existing,
      newState: rule,
      performedBy: userId,
    });

    return rule;
  }

  /**
   * End a recurring rule
   */
  async endRecurring(
    id: string,
    householdId: string,
    endDate?: string,
    reason?: string,
    userId?: string
  ): Promise<RecurringTransaction> {
    const existing = await recurringRepository.findById(id, householdId);
    if (!existing) {
      throw new NotFoundError("Recurring rule not found");
    }

    const finalEndDate = endDate || new Date().toISOString().split("T")[0];
    const rule = await recurringRepository.update(id, householdId, {
      endDate: finalEndDate,
      isActive: false,
      isPaused: false,
    });

    if (!rule) {
      throw new NotFoundError("Recurring rule not found");
    }

    await recurringRepository.logHistory({
      recurringTransactionId: rule.id,
      action: "ended",
      previousState: existing,
      newState: rule,
      changeReason: reason,
      performedBy: userId,
    });

    return rule;
  }
}
