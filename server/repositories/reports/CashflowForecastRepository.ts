/**
 * Cashflow Forecast Repository
 *
 * Handles forecast-related operations for cashflow reports.
 * Split from CashflowReportRepository to keep file sizes under 500 LOC.
 *
 * @module repositories/reports/CashflowForecastRepository
 */

import { db } from "../../db";
import { eq, and, inArray } from "drizzle-orm";
import {
  budgets,
  budgetPeriods,
  categories,
} from "@shared/schema";
import type {
  RecurringRuleInput,
  ForecastBudgetInput,
} from "../../core/calculations/cashflow";
import { isHouseholdRole } from "../../core/authz/capabilities";
import { householdRepository } from "../HouseholdRepository";
import { listVisibleRecurringRules } from "../../services/recurring/RecurringAudienceQuery";
import { recurringAmountsIn } from "./RecurringForecastUnit";
import type { HouseholdContext } from "../../middleware/householdGuard";

/** The reader's membership decides which rules feed the forecast; none fails closed. */
async function resolveReader(householdId: string, userId: string | undefined): Promise<HouseholdContext | undefined> {
  if (!userId) return undefined;
  const membership = await householdRepository.findMember(householdId, userId);
  if (!membership || !isHouseholdRole(membership.role)) return undefined;
  return { householdId, userId, role: membership.role };
}

/**
 * Get the active recurring rules this reader may see, for forecast generation.
 *
 * A rule on another member's private account is filtered out through the same
 * `visibleRulePredicate` the recurring screens use (FIN-01 / OPS-005), so the
 * forecast and its export never project an amount the reader cannot see.
 *
 * @param householdId - The household context
 * @param userId - The member reading the report
 * @param currency - The household currency
 * @returns Visible active recurring rules normalized for forecasting
 */
export async function getActiveRecurringRules(
  householdId: string,
  userId: string | undefined,
  currency: string,
): Promise<RecurringRuleInput[]> {
  const reader = await resolveReader(householdId, userId);
  if (!reader) return [];
  const rules = await listVisibleRecurringRules(reader, { includePaused: true });
  // A-10: each amount in its proven unit, converted once into `currency`.
  const amounts = await recurringAmountsIn(householdId, rules, currency);

  // A rule with no amount in `currency` is not counted (inactive or paused), so it is left out.
  return rules.flatMap((r): RecurringRuleInput[] => {
    const amount = amounts.get(r.id);
    if (amount === undefined) return [];
    return [{
      id: r.id,
      type: r.type as "income" | "expense",
      amount,
      currency,
      frequency: r.frequency as RecurringRuleInput["frequency"],
      intervalValue: r.intervalValue,
      intervalUnit: r.intervalUnit as RecurringRuleInput["intervalUnit"],
      nextDueDate: r.nextDueDate,
      endDate: r.endDate,
      isActive: r.isActive,
      isPaused: r.isPaused,
    }];
  });
}

/**
 * Get budgets for forecast comparison.
 *
 * Fetches active category budgets to set spending limits/targets
 * in the forecast mode.
 *
 * @param householdId - The household context
 * @returns List of budgets with period and amount
 */
export async function getBudgetsForHousehold(
  householdId: string,
): Promise<ForecastBudgetInput[]> {
  const budgetData = await db
    .select({
      id: budgets.id,
      categoryId: budgets.categoryId,
      categoryName: categories.name,
      amount: budgets.amount,
      currency: budgets.currency,
      period: budgets.period,
    })
    .from(budgets)
    .leftJoin(categories, eq(budgets.categoryId, categories.id))
    .where(and(eq(budgets.householdId, householdId), eq(budgets.isActive, true)));

  const periods = budgetData.length ? await db.select().from(budgetPeriods)
    .where(inArray(budgetPeriods.budgetId, budgetData.map(row => row.id))) : [];
  const defaults: ForecastBudgetInput[] = budgetData
    .filter((b): b is typeof b & { categoryId: string; amount: string } => b.categoryId !== null && b.amount !== null)
    .map((b) => ({
      categoryId: b.categoryId!,
      categoryName: b.categoryName || "Unknown",
      amount: b.amount,
      currency: b.currency,
      periodType: (b.period === "yearly" ? "yearly" : "monthly") as
        | "monthly"
        | "yearly",
    }));
  const overrides: ForecastBudgetInput[] = periods.flatMap(period => {
    const budget = budgetData.find(row => row.id === period.budgetId);
    if (!budget?.categoryId) return [];
    return [{ categoryId: budget.categoryId, categoryName: budget.categoryName || "Unknown", amount: period.budgetAmount,
      currency: period.currency, periodType: "monthly" as const, targetPeriod: period.startDate.slice(0, 7) }];
  });
  return [...defaults, ...overrides];
}
