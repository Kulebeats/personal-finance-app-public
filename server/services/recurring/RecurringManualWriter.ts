import { and, eq, isNull } from "drizzle-orm";
import { accounts, categories, householdMembers, households, merchants, recurringTransactions, type InsertRecurringTransaction } from "@shared/schema";
import { db } from "../../db";
import { can } from "../../core/authz/capabilities";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import { isPostgresError } from "../../utils/postgresError";
import { recordRecurringDenomination, withRecurringDefinitionMetadata } from "./RecurringDenomination";
import { auditRecurringRule, type RecurringAuditRequest } from "./RecurringRuleAudit";

/** A signed amount DTO is the denomination assertion; current account metadata only validates compatibility. */
export async function createSignedManualRule(
  data: Omit<InsertRecurringTransaction, "householdId">, actor: HouseholdContext, currency: string,
  /** Request context for the CREATE audit row, written in the rule's transaction (FIN-13). */
  audit?: RecurringAuditRequest,
) {
  if (currency !== "ZMW") throw new ValidationError("Recurring denomination is not supported. Enter a ZMW amount or wait for multi-currency recurring support.");
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async tx => {
        // Household before member: the audit FK lock order (FIN-13).
        const [household] = await tx.select({ currency: households.currency }).from(households).where(eq(households.id, actor.householdId)).for("share");
        const [grant] = await tx.select({ role: householdMembers.role }).from(householdMembers)
          .where(and(eq(householdMembers.householdId, actor.householdId), eq(householdMembers.userId, actor.userId))).for("share");
        if (!grant || !can(grant.role, "financial.write") || !can(actor.role, "financial.write")) throw new ForbiddenError("Financial write access required");
        const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, data.accountId), visibleAccountPredicate(actor))).for("share");
        if (!account) throw new NotFoundError("Account");
        if (account.currency !== currency || household?.currency !== currency) throw new ValidationError("Recurring denomination must match the destination and household; multi-currency recurring is not yet supported.");
        if (data.categoryId) {
          const [category] = await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.id, data.categoryId),
            eq(categories.householdId, actor.householdId), isNull(categories.deletedAt))).for("share");
          if (!category) throw new NotFoundError("Category");
        }
        if (data.merchantId) {
          const [merchant] = await tx.select({ id: merchants.id }).from(merchants).where(and(eq(merchants.id, data.merchantId), eq(merchants.householdId, actor.householdId))).for("share");
          if (!merchant) throw new NotFoundError("Merchant");
        }
        const [rule] = await tx.insert(recurringTransactions).values({ ...data, householdId: actor.householdId, detectionMethod: "manual" }).returning();
        await recurringRepository.logHistory({ recurringTransactionId: rule.id, action: "created", newState: rule, performedBy: actor.userId }, tx);
        await recordRecurringDenomination(tx, rule, currency, actor.userId, "manual_creation");
        if (audit) await auditRecurringRule(tx, "CREATE", rule.id, actor, audit, { newValue: { name: rule.name, amount: rule.amount } });
        return withRecurringDefinitionMetadata(rule, "ZMW");
      }, { isolationLevel: "serializable" });
    } catch (error) {
      if (!isPostgresError(error, "40001") && !isPostgresError(error, "40P01")) throw error;
      if (attempt >= 3) throw new ConflictError("Recurring destination changed; retry creating the rule.");
    }
  }
}
