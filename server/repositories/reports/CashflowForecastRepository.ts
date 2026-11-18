/**
 * Cashflow Forecast Repository
 *
 * Handles forecast-related operations for cashflow reports.
 * Split from CashflowReportRepository to keep file sizes under 500 LOC.
 *
 * @module repositories/reports/CashflowForecastRepository
 */

import { db } from "../../db";
import { eq, and } from "drizzle-orm";
import {
  recurringTransactions,
  budgets,
  categories,
} from "@shared/schema";
import type {
  RecurringRuleInput,
  ForecastBudgetInput,
} from "../../core/calculations/cashflow";

/**
 * Get active recurring rules for forecast generation.
 *
 * Fetches all active recurring transactions for the household.
 * These are used to project future fixed income/expenses.
 *
 * @param householdId - The household context
 * @param currency - The household currency
 * @returns List of active recurring rules normalized for forecasting
 */
export async function getActiveRecurringRules(
  householdId: string,
  currency: string,
): Promise<RecurringRuleInput[]> {
  const rules = await db
    .select()
    .from(recurringTransactions)
    .where(
      and(
        eq(recurringTransactions.householdId, householdId),
        eq(recurringTransactions.isActive, true),
      ),
    );

  return rules.map((r) => ({
    id: r.id,
    type: r.type as "income" | "expense",
    amount: r.amount,
    currency, // Use household currency since recurring rules don't store currency
    frequency: r.frequency as RecurringRuleInput["frequency"],
    intervalValue: r.intervalValue,
    intervalUnit: r.intervalUnit as RecurringRuleInput["intervalUnit"],
    nextDueDate: r.nextDueDate,
    endDate: r.endDate,
    isActive: r.isActive,
    isPaused: r.isPaused,
  }));
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
      period: budgets.period,
    })
    .from(budgets)
    .leftJoin(categories, eq(budgets.categoryId, categories.id))
    .where(eq(budgets.householdId, householdId));

  return budgetData
    .filter((b) => b.categoryId !== null)
    .map((b) => ({
      categoryId: b.categoryId!,
      categoryName: b.categoryName || "Unknown",
      amount: b.amount,
      currency: "ZMW", // Budgets use household currency
      periodType: (b.period === "yearly" ? "yearly" : "monthly") as
        | "monthly"
        | "yearly",
    }));
}
