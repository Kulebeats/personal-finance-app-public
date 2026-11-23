import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BudgetRecalculationApplyInput, BudgetRecalculationApplyResult } from "@shared/budget-recalculation-apply";
import type { BudgetRecalculationSuggestion } from "@shared/budget-recalculation-preview";
import { auditLogs, budgetPeriods, budgets, householdMembers, households } from "@shared/schema";
import { db } from "../../db";
import { ConflictError, ForbiddenError, ValidationError } from "../../core/errors";
import { Money } from "../../core/money";
import { readBudgetPreviewInputs } from "../../repositories/BudgetPreviewReadRepository";
import { isPostgresError } from "../../utils/postgresError";
import { assembleBudgetRecalculationPreview } from "./BudgetHistoricalPreviewService";
import { invalidateOnChangeAfterCommit } from "../CacheInvalidation";

const operation = "confirmed-budget-suggestions-v1";
const key = (row: BudgetRecalculationSuggestion) => row.categoryId ? `category:${row.categoryId}` : `group:${row.categoryGroupId}`;
function canonical(row: BudgetRecalculationSuggestion) {
  return { categoryId: row.categoryId, categoryGroupId: row.categoryGroupId,
    historicalTotal: { amount: row.historicalTotal.amount, currency: row.historicalTotal.currency },
    amount: { amount: row.amount.amount, currency: row.amount.currency },
    currentBudget: row.currentBudget === null ? null : { id: row.currentBudget.id,
      amount: { amount: row.currentBudget.amount.amount, currency: row.currentBudget.amount.currency },
      periodId: row.currentBudget.periodId, periodVersion: row.currentBudget.periodVersion } };
}
function intentHash(input: BudgetRecalculationApplyInput) {
  const suggestions = [...input.suggestions].sort((a, b) => key(a).localeCompare(key(b))).map(canonical);
  return createHash("sha256").update(JSON.stringify({ months: input.months, targetPeriod: input.targetPeriod, suggestions })).digest("hex");
}
const same = (a: BudgetRecalculationSuggestion, b: BudgetRecalculationSuggestion) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const stale = () => new ConflictError("Budget suggestions or access changed. Refresh the preview and confirm again.");

/** A batch receipt and every selected period write commit together. Shared
 * limits may only contain estimates independently reproducible from shared
 * sources: actor-private historical money is never persisted or audited. */
async function commitBudgetRecalculation(householdId: string, userId: string,
  input: BudgetRecalculationApplyInput): Promise<BudgetRecalculationApplyResult> {
  const hash = intentHash(input), result = { operationId: input.operationId, targetPeriod: input.targetPeriod, appliedCount: input.suggestions.length };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(async tx => {
        // Lock the live membership through commit, including on replay. Role
        // middleware alone can have observed an earlier membership version.
        const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers)
          .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId))).for("share");
        if (!member || !["owner", "admin", "member"].includes(member.role)) throw new ForbiddenError("Budget editing access denied");
        // This existing row also serializes two absent-category creations and
        // cooperates with the historical direct recalculation service.
        await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("update");
        const [receipt] = await tx.select().from(auditLogs).where(eq(auditLogs.id, input.operationId));
        if (receipt) {
          const details = receipt.details as Record<string, unknown> | null;
          if (receipt.householdId !== householdId || receipt.userId !== userId || receipt.entityType !== "budget" ||
              details?.operation !== operation || details.intentHash !== hash) throw stale();
          return result; // No source amounts are returned or re-persisted.
        }
        const lockedBudgets = await tx.select().from(budgets).where(eq(budgets.householdId, householdId)).orderBy(budgets.id).for("update");
        if (lockedBudgets.length) await tx.select({ id: budgetPeriods.id }).from(budgetPeriods)
          .where(inArray(budgetPeriods.budgetId, lockedBudgets.map(row => row.id))).orderBy(budgetPeriods.id).for("update");
        const visibleInputs = await readBudgetPreviewInputs(tx, householdId, userId, input.months);
        const visible = assembleBudgetRecalculationPreview(visibleInputs);
        const shared = assembleBudgetRecalculationPreview(await readBudgetPreviewInputs(tx, householdId, userId, input.months, true));
        if (visible.targetPeriod !== input.targetPeriod) throw stale();
        for (const selected of input.suggestions) {
          const current = visible.suggestions.find(row => key(row) === key(selected));
          const shareable = shared.suggestions.find(row => key(row) === key(selected));
          if (!current || !shareable || !same(selected, current) || !same(current, shareable)) throw stale();
          const existing = visibleInputs.budgets.find(row => row.categoryId === selected.categoryId && row.categoryGroupId === selected.categoryGroupId);
          if ((existing && existing.currency !== current.amount.currency) ||
              (current.currentBudget && current.currentBudget.amount.currency !== current.amount.currency)) throw stale();
          if (new Money(current.amount.amount, current.amount.currency).gt(new Money("9999999999999.99", current.amount.currency))) {
            throw new ValidationError("Suggested amount exceeds the supported budget limit");
          }
        }
        const first = `${input.targetPeriod}-01`, end = new Date(`${first}T00:00:00Z`);
        end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
        const changes: Array<{ budgetId: string; periodId: string; before: BudgetRecalculationSuggestion["currentBudget"]; amount: BudgetRecalculationSuggestion["amount"] }> = [];
        for (const selected of input.suggestions) {
          let budget = lockedBudgets.find(row => row.isActive && !row.isFlexBucket && row.categoryId === selected.categoryId && row.categoryGroupId === selected.categoryGroupId);
          if (!budget) {
            [budget] = await tx.insert(budgets).values({ householdId, categoryId: selected.categoryId, categoryGroupId: selected.categoryGroupId,
              name: "Confirmed monthly limit", amount: null, currency: selected.amount.currency, period: "monthly" }).returning();
          }
          if (selected.currentBudget?.periodId) {
            const changed = await tx.update(budgetPeriods).set({ budgetAmount: selected.amount.amount,
              version: sql`${budgetPeriods.version}+1`, updatedAt: new Date() }).where(and(
              eq(budgetPeriods.id, selected.currentBudget.periodId), eq(budgetPeriods.budgetId, budget.id),
              eq(budgetPeriods.version, selected.currentBudget.periodVersion!), eq(budgetPeriods.startDate, first), eq(budgetPeriods.endDate, end.toISOString().slice(0, 10)),
            )).returning({ id: budgetPeriods.id });
            if (changed.length !== 1) throw stale();
            changes.push({ budgetId: budget.id, periodId: changed[0].id, before: selected.currentBudget, amount: selected.amount });
          } else {
            const [created] = await tx.insert(budgetPeriods).values({ budgetId: budget.id, startDate: first, endDate: end.toISOString().slice(0, 10),
              budgetAmount: selected.amount.amount, currency: selected.amount.currency }).returning({ id: budgetPeriods.id });
            changes.push({ budgetId: budget.id, periodId: created.id, before: selected.currentBudget, amount: selected.amount });
          }
        }
        // The UUID primary key is durable, globally unique operation evidence.
        // Store a digest rather than the actor's submitted historical payload.
        await tx.insert(auditLogs).values({ id: input.operationId, householdId, userId, action: "UPDATE", entityType: "budget", entityId: input.operationId,
          details: { operation, intentHash: hash, targetPeriod: input.targetPeriod, appliedCount: result.appliedCount, changes } });
        return result;
      }, { isolationLevel: "serializable" });
    } catch (error) {
      if (isPostgresError(error, "40001") || isPostgresError(error, "40P01") || isPostgresError(error, "23505")) {
        if (attempt < 2) continue;
        throw stale();
      }
      throw error;
    }
  }
  throw stale();
}

export async function applyBudgetRecalculation(householdId: string, userId: string,
  input: BudgetRecalculationApplyInput): Promise<BudgetRecalculationApplyResult> {
  const result = await commitBudgetRecalculation(householdId, userId, input);
  // Both new commits and receipt replays retry optional cache work. This lives
  // outside the financial retry loop: a postcommit failure cannot reapply money.
  await invalidateOnChangeAfterCommit("budget", householdId);
  return result;
}
