import { accountRepository } from "../../repositories/AccountRepository";
import { categoryRepository } from "../../repositories/CategoryRepository";
import { merchantRepository } from "../../repositories/MerchantRepository";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { accounts, categories, merchants, type InsertRecurringTransaction, type RecurringTransaction } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";
import { EventTypes, outboxEventService } from "../../core/events";
import { Money } from "../../core/money";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { getVisibleRecurringRuleById, listVisibleRecurringRules } from "./RecurringAudienceQuery";
import { withWritableRecurringRule } from "./withWritableRecurringRule";
import { createSignedManualRule } from "./RecurringManualWriter";
import { auditRecurringRule, type RecurringAuditRequest } from "./RecurringRuleAudit";

const ruleAuditValues = ({ name, amount, frequency, isActive }: RecurringTransaction) => ({ name, amount, frequency, isActive });
import { getVerifiedRecurringRuleCurrency, invalidateRecurringDenomination, recordRecurringDenomination, recurringDefinitionToken, withRecurringDefinitionMetadata, type VisibleRecurringRule } from "./RecurringDenomination";

import { RecurringLifecycleService } from "./RecurringLifecycleService";

export class RecurringBaseService extends RecurringLifecycleService {
  /** Actor-scoped readers used only by ordinary GET routes. */
  async getVisibleRecurringRules(actor: HouseholdContext, options?: { includeInactive?: boolean; includePaused?: boolean }): Promise<VisibleRecurringRule[]> {
    return listVisibleRecurringRules(actor, options);
  }

  async getVisibleRecurringById(id: string, actor: HouseholdContext): Promise<VisibleRecurringRule> {
    return getVisibleRecurringRuleById(id, actor);
  }

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
  getUpcomingBills(scope: HouseholdContext, withinDays?: number): Promise<VisibleRecurringRule[]>;
  getUpcomingBills(scope: string, withinDays?: number): Promise<RecurringTransaction[]>;
  async getUpcomingBills(
    scope: HouseholdContext | string,
    withinDays: number = 14
  ): Promise<RecurringTransaction[]> {
    return typeof scope === "string"
      ? recurringRepository.findUpcoming(scope, withinDays)
      : listVisibleRecurringRules(scope, { withinDays });
  }

  /**
   * Create a new recurring rule
   */
  async createRecurring(
    data: Omit<InsertRecurringTransaction, "householdId">,
    householdId: string,
    userId: string,
    /** `audit`: request context for the CREATE row, written in the rule's transaction (FIN-13). */
    denomination?: { actor: HouseholdContext; currency: string; audit?: RecurringAuditRequest },
  ): Promise<VisibleRecurringRule> {
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

    if (denomination && (denomination.actor.householdId !== householdId || denomination.actor.userId !== userId)) throw new NotFoundError("Recurring rule");
    // A rule created without a denomination receipt has no proven unit.
    const rule = denomination ? await createSignedManualRule(data, denomination.actor, denomination.currency, denomination.audit) : withRecurringDefinitionMetadata(await recurringRepository.create({
      ...data,
      householdId,
    }), null);

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

    if (!denomination) await recurringRepository.logHistory({
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
    actor: HouseholdContext,
    denomination?: { confirmDenomination?: boolean; currency?: string; expectedDefinition?: string },
    /** Request context for the UPDATE audit row, written in the update's transaction (FIN-13). */
    audit?: RecurringAuditRequest,
  ): Promise<{ beforeRule: RecurringTransaction; rule: VisibleRecurringRule }> {
    id = id.toLowerCase();
    data = { ...data, ...(data.accountId === undefined ? {} : { accountId: data.accountId.toLowerCase() }) };
    const { beforeRule, rule } = await withWritableRecurringRule(id, actor, async (tx, beforeRule, audience) => {
      const knownCurrency = audience.currencies.get(beforeRule.id);
      const confirm = denomination?.confirmDenomination === true;
      const definitionChanged = data.amount !== undefined || data.accountId !== undefined;
      if (confirm && (data.amount === undefined || denomination?.currency === undefined)) throw new ValidationError("Confirm the entered amount and its ZMW denomination.");
      if (confirm && !denomination?.expectedDefinition) throw new ValidationError("Reload the recurring rule before confirming its denomination.");
      if (confirm && denomination?.expectedDefinition !== recurringDefinitionToken(beforeRule)) {
        throw new ConflictError("Recurring definition changed. Reload it and enter the intended amount again.");
      }
      const carryUnit = confirm || (knownCurrency === "ZMW" && definitionChanged);
      if (carryUnit) {
        const currency = denomination?.currency ?? knownCurrency;
        const destination = audience.accounts.find(account => account.id === (data.accountId ?? beforeRule.accountId));
        if (currency !== "ZMW" || destination?.currency !== currency || audience.householdCurrency !== currency) {
          throw new ValidationError("Recurring denomination must be ZMW and match the destination and household; multi-currency recurring is not yet supported.");
        }
      }
      // The audience guard already holds current/source/destination account locks.
      if (data.accountId !== undefined) {
        const [account] = await tx.select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.id, data.accountId), visibleAccountPredicate(actor)))
          .limit(1);
        if (!account) throw new NotFoundError("Recurring rule");
      }

      if (data.amount !== undefined) {
        const amountMoney = new Money(data.amount);
        if (amountMoney.isNegative() || amountMoney.isZero()) {
          throw new ValidationError("Invalid amount", [
            { field: "amount", message: "Must be a positive number" },
          ]);
        }
      }
      if (data.frequency === "custom") {
        const intervalUnit = data.intervalUnit ?? beforeRule.intervalUnit;
        const intervalValue = data.intervalValue ?? beforeRule.intervalValue;
        if (!intervalUnit || !intervalValue) {
          throw new ValidationError("Custom frequency requires interval values", [
            { field: "intervalUnit", message: "Required for custom frequency" },
          ]);
        }
      }
      if (data.categoryId !== undefined && data.categoryId !== null) {
        const [category] = await tx.select({ id: categories.id }).from(categories)
          .where(and(eq(categories.id, data.categoryId), eq(categories.householdId, actor.householdId), isNull(categories.deletedAt))).limit(1);
        if (!category) throw new NotFoundError("Category not found");
      }
      if (data.merchantId !== undefined && data.merchantId !== null) {
        const [merchant] = await tx.select({ id: merchants.id }).from(merchants)
          .where(and(eq(merchants.id, data.merchantId), eq(merchants.householdId, actor.householdId))).limit(1);
        if (!merchant) throw new NotFoundError("Merchant not found");
      }

      const rule = await recurringRepository.update(id, actor.householdId, data, tx);
      if (!rule) throw new NotFoundError("Recurring rule");
      await recurringRepository.logHistory({
        recurringTransactionId: rule.id,
        action: "updated",
        previousState: beforeRule,
        newState: rule,
        performedBy: actor.userId,
      }, tx);
      if (carryUnit) await recordRecurringDenomination(tx, rule, "ZMW", actor.userId, confirm ? "manual_confirmation" : "known_unit_edit");
      else if (definitionChanged) await invalidateRecurringDenomination(tx, rule.id, actor.userId);
      if (audit) {
        await auditRecurringRule(tx, "UPDATE", rule.id, actor, audit, {
          oldValue: ruleAuditValues(beforeRule), newValue: ruleAuditValues(rule),
        });
      }
      return { beforeRule, rule: withRecurringDefinitionMetadata(rule, await getVerifiedRecurringRuleCurrency(rule.id, actor.householdId, tx)) };
    }, {
      additionalAccountIds: data.accountId === undefined ? [] : [data.accountId],
      additionalCategoryIds: data.categoryId ? [data.categoryId] : [],
      additionalMerchantIds: data.merchantId ? [data.merchantId] : [],
      lockAccountsForUpdate: true,
    });

    logger.info("Recurring rule updated", { householdId: actor.householdId });

    // Emit recurring updated event
    outboxEventService
      .publish({
        eventType: EventTypes.RECURRING_UPDATED,
        aggregateType: "recurring",
        aggregateId: id,
        householdId: actor.householdId,
        payload: { id, changes: Object.keys(data) },
      })
      .catch((err) =>
        logger.error("Failed to publish recurring event", { err })
      );

    return { beforeRule, rule };
  }

}
