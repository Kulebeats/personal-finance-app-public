/**
 * Rule Matching Logic
 *
 * Condition evaluation for transaction rules.
 *
 * @module services/rule/matching
 */

import { type Transaction } from "@shared/schema";
import { Money } from "../../core/money";
import { compileSafeRegex } from "../../core/safeRegex";
import { logger } from "../../utils/logger";
import { merchantRepository } from "../../repositories/MerchantRepository";
import type { Rule, RuleCondition, MerchantCache } from "./types";

/**
 * Check if a rule matches a transaction
 */
export async function matchesRule(
  rule: Rule,
  transaction: Transaction,
  householdId: string,
  merchantCache: MerchantCache
): Promise<boolean> {
  const conditions = rule.conditions as RuleCondition[];
  // Filter to only enabled conditions (default to true if enabled is undefined)
  const activeConditions = conditions.filter((c) => c.enabled !== false);

  if (activeConditions.length === 0) {
    return false; // No active conditions means no match
  }

  // Check conditionLogic - stored as top-level field on rule
  // Defaults to 'all' if not specified
  const logic = rule.conditionLogic ?? "all";

  if (logic === "any") {
    // ANY: at least one condition must match
    for (const condition of activeConditions) {
      const matches = await evaluateCondition(
        condition,
        transaction,
        householdId,
        merchantCache
      );
      if (matches) return true;
    }
    return false;
  } else {
    // ALL: every condition must match (default)
    for (const condition of activeConditions) {
      const matches = await evaluateCondition(
        condition,
        transaction,
        householdId,
        merchantCache
      );
      if (!matches) return false;
    }
    return true;
  }
}

/**
 * Evaluate a single condition against a transaction
 */
export async function evaluateCondition(
  condition: RuleCondition,
  transaction: Transaction,
  householdId: string,
  merchantCache: MerchantCache
): Promise<boolean> {
  const { type, operator, value, value2 } = condition;

  let fieldValue: string | number | Money | null | undefined;

  switch (type) {
    case "original_statement":
      // Original statement is the pre-cleanup name stored in originalName
      fieldValue = transaction.originalName || transaction.name;
      break;
    case "merchant_name":
      fieldValue = transaction.name; // Merchant name is stored in 'name'
      break;
    case "merchant_category": {
      const merchant = await resolveMerchant(
        transaction.merchantId,
        householdId,
        merchantCache
      );
      fieldValue = merchant?.category;
      break;
    }
    case "amount":
      // Amount is string decimal in DB, use Money class for precision-safe comparisons
      fieldValue = new Money(transaction.amount).abs();
      break;
    case "account":
      fieldValue = transaction.accountId;
      break;
    case "category":
      fieldValue = transaction.categoryId;
      break;
    case "description":
      fieldValue = transaction.notes || "";
      break;
    case "transaction_type":
      fieldValue = transaction.type;
      break;
    default:
      return false;
  }

  if (fieldValue === undefined || fieldValue === null) return false;

  // Handle Money-specific comparisons
  if (fieldValue instanceof Money) {
    // Value should be string or number for Money comparisons (not array)
    if (Array.isArray(value)) return false;

    switch (operator) {
      case "equals":
        return fieldValue.equals(value);
      case "not_equals":
        return !fieldValue.equals(value);
      case "greater_than":
        return fieldValue.gt(value);
      case "less_than":
        return fieldValue.lt(value);
      case "range": {
        if (value2 === undefined) return false;
        return fieldValue.gte(value) && fieldValue.lte(value2);
      }
      default:
        return false;
    }
  }

  // Handle string/number comparisons
  switch (operator) {
    case "equals":
      return String(fieldValue).toLowerCase() === String(value).toLowerCase();
    case "not_equals":
      return String(fieldValue).toLowerCase() !== String(value).toLowerCase();
    case "contains":
      return String(fieldValue)
        .toLowerCase()
        .includes(String(value).toLowerCase());
    case "starts_with":
      return String(fieldValue)
        .toLowerCase()
        .startsWith(String(value).toLowerCase());
    case "ends_with":
      return String(fieldValue)
        .toLowerCase()
        .endsWith(String(value).toLowerCase());
    case "not_contains":
      return !String(fieldValue)
        .toLowerCase()
        .includes(String(value).toLowerCase());
    case "greater_than":
      return Number(fieldValue) > Number(value);
    case "less_than":
      return Number(fieldValue) < Number(value);
    case "range":
      return (
        Number(fieldValue) >= Number(value) &&
        Number(fieldValue) <= Number(value2)
      );
    case "regex": {
      // Never compile a user pattern directly: a valid-but-pathological one
      // (e.g. `(a+)+$`) backtracks exponentially and blocks the event loop for
      // every household. Rules stored before this guard existed are still
      // evaluated here, so the check cannot live only at the write path.
      const pattern = String(value);
      const regex = compileSafeRegex(pattern, "i");
      if (!regex) {
        // Skip the condition rather than throwing, so one legacy rule cannot
        // fail an entire apply-to-past batch.
        logger.warn("Skipping rule condition with unsafe or invalid regex", {
          conditionType: type,
        });
        return false;
      }
      return regex.test(String(fieldValue));
    }
    default:
      return false;
  }
}

/**
 * Resolve merchant from cache or database
 */
export async function resolveMerchant(
  merchantId: string | null | undefined,
  householdId: string,
  merchantCache: MerchantCache
) {
  if (!merchantId) return null;
  if (merchantCache.has(merchantId)) {
    return merchantCache.get(merchantId) ?? null;
  }

  const merchant = await merchantRepository.findByIdAndHousehold(
    merchantId,
    householdId
  );
  merchantCache.set(merchantId, merchant ?? null);
  return merchant ?? null;
}
