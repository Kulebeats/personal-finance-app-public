import type { Budget } from "@shared/schema";
import Decimal from "decimal.js";
import { Money } from "../core/money";
import { budgetRepository } from "./BudgetRepository";
import { loadBudgetContext } from "./budgetQueryUtils";

/**
 * BudgetQueryRepository
 *
 * Read-optimized queries and budget progress calculations.
 */
export class BudgetQueryRepository {
  /**
   * Get all budgets with their calculated spent amounts for a month
   */
  async getBudgetsWithProgress(
    householdId: string,
    year: number,
    month: number,
    options?: {
      autoRolloverBudget?: boolean;
      rolloverPercentage?: number;
      currency?: string;
    },
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
    const currency = options?.currency ?? "ZMW";
    const allowAutoRollover = options?.autoRolloverBudget ?? true;
    const rolloverPercentageValue = new Decimal(
      Math.min(Math.max(options?.rolloverPercentage ?? 100, 0), 100),
    );
    const budgetList = await budgetRepository.findByHousehold(householdId);
    const context =
      budgetList.length > 0
        ? await loadBudgetContext(householdId, budgetList)
        : null;

    // Calculate date range for the month
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
    const budgetIds = budgetList.map((budget) => budget.id);
    const currentPeriods = await budgetRepository.getBudgetPeriodsForRange(
      budgetIds,
      startDate,
      endDate,
    );
    const currentPeriodByBudgetId = new Map(
      currentPeriods.map((period) => [period.budgetId, period]),
    );

    const prevDate = new Date(year, month - 2, 1);
    const prevYear = prevDate.getFullYear();
    const prevMonth = prevDate.getMonth() + 1;
    const prevStartDate = `${prevYear}-${String(prevMonth).padStart(2, "0")}-01`;
    const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
    const prevEndDate = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${prevLastDay}`;
    const prevPeriods = await budgetRepository.getBudgetPeriodsForRange(
      budgetIds,
      prevStartDate,
      prevEndDate,
    );
    const prevPeriodByBudgetId = new Map(
      prevPeriods.map((period) => [period.budgetId, period]),
    );

    // ISSUE-011: Batch calculate spent amounts to fix N+1 query
    // Collect all category IDs and category group IDs
    const categoryIds = budgetList
      .map((b) => b.categoryId)
      .filter((id): id is string => Boolean(id));
    const categoryGroupIds = budgetList
      .map((b) => b.categoryGroupId)
      .filter((id): id is string => Boolean(id));

    // Build type maps for determining income vs expense
    const categoryTypeMap = new Map<string, "income" | "expense">();
    const groupTypeMap = new Map<string, "income" | "expense">();

    if (context) {
      for (const budget of budgetList) {
        if (budget.categoryId) {
          const category = context.categoryMap.get(budget.categoryId);
          const group = category?.groupId
            ? context.groupMap.get(category.groupId)
            : null;
          const txType = group?.type === "income" ? "income" : "expense";
          categoryTypeMap.set(budget.categoryId, txType);
        }
        if (budget.categoryGroupId) {
          const group = context.groupMap.get(budget.categoryGroupId);
          const txType = group?.type === "income" ? "income" : "expense";
          groupTypeMap.set(budget.categoryGroupId, txType);
        }
      }
    }

    // Batch fetch spent amounts for current period
    const currentSpent = await budgetRepository.batchCalculateSpent(
      householdId,
      categoryIds,
      categoryGroupIds,
      startDate,
      endDate,
      currency,
      categoryTypeMap,
      groupTypeMap,
    );

    // Batch fetch spent amounts for previous period (for rollover)
    const prevSpent = await budgetRepository.batchCalculateSpent(
      householdId,
      categoryIds,
      categoryGroupIds,
      prevStartDate,
      prevEndDate,
      currency,
      categoryTypeMap,
      groupTypeMap,
    );

    // Helper to look up spent from batch results
    const getSpentFromBatch = (
      budget: Budget,
      spentData: typeof currentSpent,
    ): Money => {
      if (budget.isFlexBucket) {
        return spentData.flexTotal;
      }
      if (budget.categoryId) {
        return (
          spentData.byCategoryId.get(budget.categoryId) || Money.zero(currency)
        );
      }
      if (budget.categoryGroupId) {
        return (
          spentData.byCategoryGroupId.get(budget.categoryGroupId) ||
          Money.zero(currency)
        );
      }
      return Money.zero(currency);
    };

    // ISSUE-011: Use batch results instead of N+1 queries
    const results = budgetList.map((budget) => {
      const currentPeriod = currentPeriodByBudgetId.get(budget.id);
      const currentBudgetAmount = Money.from(
        currentPeriod?.budgetAmount ?? budget.amount,
        currency,
      );
      let rolloverEnabled = budget.rolloverEnabled;
      let rolloverStartBalance = budget.rolloverAmount;

      if (budget.categoryId) {
        const category = context?.categoryMap.get(budget.categoryId) || null;
        if (!rolloverEnabled && category?.rolloverEnabled) {
          rolloverEnabled = true;
          rolloverStartBalance = category.rolloverStartBalance || "0";
        }
      } else if (budget.categoryGroupId) {
        const group = context?.groupMap.get(budget.categoryGroupId) || null;
        if (!rolloverEnabled && group?.rolloverEnabled) {
          rolloverEnabled = true;
        }
      }

      if (!allowAutoRollover) {
        rolloverEnabled = false;
      }

      // Use batch results instead of individual query
      const spent = getSpentFromBatch(budget, currentSpent);

      let rollover = Money.zero(currency);
      if (rolloverEnabled) {
        const prevPeriod = prevPeriodByBudgetId.get(budget.id);
        const prevBudgetAmount = Money.from(
          prevPeriod?.budgetAmount ?? budget.amount,
          currency,
        );
        const prevRolloverIn = Money.from(
          prevPeriod?.rolloverIn ??
            (rolloverStartBalance ? rolloverStartBalance : "0"),
          currency,
        );
        // Use batch results instead of individual query
        const prevSpentAmount = getSpentFromBatch(budget, prevSpent);

        // rollover = prevRolloverIn + prevBudgetAmount - prevSpent
        let rolloverCalc = prevRolloverIn
          .add(prevBudgetAmount)
          .subtract(prevSpentAmount);
        if (rolloverCalc.isPositive()) {
          // Apply rollover percentage using Decimal
          rolloverCalc = rolloverCalc.multiply(
            rolloverPercentageValue.dividedBy(100),
          );
        }
        // Check for valid number (replaces !Number.isFinite check)
        if (!rolloverCalc.amount.isFinite()) {
          rolloverCalc = Money.zero(currency);
        }
        rollover = rolloverCalc;
        // Note: Period persistence is handled by BudgetCoreService.processBudgetRollover()
        // This method is now a pure read operation
      }

      const totalBudget = currentBudgetAmount.add(rollover);
      const remaining = totalBudget.subtract(spent);

      // Calculate percentUsed using Decimal for precision
      const spentDecimal = spent.amount;
      const totalBudgetDecimal = totalBudget.amount;
      const percentUsed = totalBudgetDecimal.isPositive()
        ? spentDecimal
            .dividedBy(totalBudgetDecimal)
            .times(100)
            .toDecimalPlaces(2)
            .toNumber()
        : 0;

      return {
        ...budget,
        amount: currentBudgetAmount.toString(),
        spent,
        remaining,
        percentUsed,
        rolloverIn: rollover,
      };
    });

    return results;
  }
}

export const budgetQueryRepository = new BudgetQueryRepository();
