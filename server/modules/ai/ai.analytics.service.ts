/**
 * AI Analytics Service
 *
 * Executes financial data queries for AI assistant tools.
 * - All currency values use Money class (not raw numbers)
 * - Respects household isolation
 * - Applies date range filters
 *
 * @module ai/ai.analytics.service
 */

import { db } from "../../db";
import { Money } from "../../core/money";
import {
  transactions,
  goals,
  budgets,
  accounts,
  recurringTransactions,
  categories,
  merchants,
} from "@shared/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { subDays, subMonths, format } from "date-fns";
import type {
  SpendingByCategoryResult,
  GoalStatusResult,
  UpcomingRecurringResult,
  BudgetStatusResult,
  TopMerchantResult,
  MonthlyTrendResult,
  RecentTransactionResult,
  AccountBalanceResult,
  QueryContext,
} from "./ai.types";
import { logger } from "../../utils/logger";
import {
  transactionPrivacyFilters,
  goalPrivacyFilters,
  accountPrivacyFilters,
  recurringPrivacyFilters,
} from "./ai.privacy-filters";

/**
 * AI Analytics Service Class
 * Provides data query methods for AI assistant tools.
 */
export class AIAnalyticsService {
  /**
   * Get spending by category for a time period.
   * Returns Money objects, NOT raw numbers.
   */
  async getSpendingByCategory(
    context: QueryContext,
    period: "7d" | "30d" | "90d" | "12m",
  ): Promise<SpendingByCategoryResult[]> {
    try {
      const { householdId, currency, userId } = context;
      const startDate = this.getPeriodStartDate(period);

      const results = await db
        .select({
          categoryId: transactions.categoryId,
          categoryName: categories.name,
          total: sql<string>`SUM(${transactions.amount})`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(
          and(
            ...transactionPrivacyFilters(householdId, userId),
            eq(transactions.type, "expense"),
            gte(transactions.date, startDate),
          ),
        )
        .groupBy(transactions.categoryId, categories.name)
        .orderBy(desc(sql`SUM(${transactions.amount})`));

      // Calculate total for percentage
      const total = results.reduce(
        (sum, r) => sum.add(Money.from(r.total, currency)),
        Money.zero(currency),
      );

      return results.map((row) => ({
        category: row.categoryName || "Uncategorized",
        amount: Money.from(row.total, currency), // Use Money class
        transactionCount: row.count,
        // FIX Money Rule 1: Keep Money through calculation, convert only at end
        percentOfTotal: total.isPositive()
          ? Money.from(row.total, currency)
              .divide(total.toString())
              .multiply("100")
              .toNumber()
          : 0,
      }));
    } catch (error) {
      logger.error("Failed to get spending by category", { error, context });
      throw error;
    }
  }

  /**
   * Get status of all household goals.
   * Returns Money objects for target and current amounts.
   */
  async getGoalsStatus(context: QueryContext): Promise<GoalStatusResult[]> {
    try {
      const { householdId, currency } = context;

      const goalsList = await db
        .select()
        .from(goals)
        .where(and(...goalPrivacyFilters(householdId)))
        .orderBy(desc(goals.createdAt));

      return goalsList.map((goal) => {
        const target = Money.from(goal.targetAmount, currency);
        const current = Money.from(goal.currentAmount, currency);

        // Determine status
        let status: "on_track" | "behind" | "ahead" | "completed";
        if (current.gte(target)) {
          status = "completed";
        } else {
          // Simple heuristic: compare progress to expected progress
          // FIX Money Rule 1: Keep Money through calculation
          const progress = target.isPositive()
            ? current.divide(target.toString()).toNumber()
            : 0;
          if (progress >= 0.8) status = "ahead";
          else if (progress >= 0.5) status = "on_track";
          else status = "behind";
        }

        return {
          goalId: goal.id,
          name: goal.name,
          target,
          current,
          status,
          projectedCompletion: goal.targetDate,
          monthlyContribution: goal.monthlyProjection
            ? Money.from(goal.monthlyProjection, currency)
            : Money.zero(currency),
        };
      });
    } catch (error) {
      logger.error("Failed to get goals status", { error, context });
      throw error;
    }
  }

  /**
   * Get upcoming recurring transactions.
   */
  async getUpcomingRecurring(
    context: QueryContext,
    days: number = 30,
  ): Promise<UpcomingRecurringResult[]> {
    try {
      const { householdId, currency } = context;
      const endDate = format(
        new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        "yyyy-MM-dd",
      );

      const rules = await db
        .select({
          id: recurringTransactions.id,
          name: recurringTransactions.name,
          amount: recurringTransactions.amount,
          nextDueDate: recurringTransactions.nextDueDate,
          frequency: recurringTransactions.frequency,
          categoryName: categories.name,
        })
        .from(recurringTransactions)
        .leftJoin(
          categories,
          eq(recurringTransactions.categoryId, categories.id),
        )
        .where(
          and(
            ...recurringPrivacyFilters(householdId),
            lte(recurringTransactions.nextDueDate, endDate),
          ),
        )
        .orderBy(recurringTransactions.nextDueDate);

      return rules.map((rule) => ({
        ruleId: rule.id,
        description: rule.name,
        amount: Money.from(rule.amount, currency),
        nextDate: rule.nextDueDate,
        frequency: rule.frequency,
        category: rule.categoryName || null,
      }));
    } catch (error) {
      logger.error("Failed to get upcoming recurring", { error, context });
      throw error;
    }
  }

  /**
   * Get budget status for current month.
   */
  async getBudgetStatus(context: QueryContext): Promise<BudgetStatusResult[]> {
    try {
      const { householdId, currency, userId } = context;
      const currentMonth = format(new Date(), "yyyy-MM");
      const monthStart = `${currentMonth}-01`;

      // Get active budgets for household
      const budgetsList = await db
        .select({
          categoryId: budgets.categoryId,
          amount: budgets.amount,
          categoryName: categories.name,
        })
        .from(budgets)
        .leftJoin(categories, eq(budgets.categoryId, categories.id))
        .where(
          and(eq(budgets.householdId, householdId), eq(budgets.isActive, true)),
        );

      if (budgetsList.length === 0) {
        return [];
      }

      // Get spending for current month (with privacy filters)
      const spending = await db
        .select({
          categoryId: transactions.categoryId,
          total: sql<string>`SUM(${transactions.amount})`,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .where(
          and(
            ...transactionPrivacyFilters(householdId, userId),
            eq(transactions.type, "expense"),
            gte(transactions.date, monthStart),
          ),
        )
        .groupBy(transactions.categoryId);

      const spendingMap = new Map(
        spending.map((s) => [s.categoryId!, Money.from(s.total, currency)]),
      );

      return budgetsList
        .filter((budget) => budget.categoryId !== null)
        .map((budget) => {
          const budgeted = Money.from(budget.amount, currency);
          const spent =
            spendingMap.get(budget.categoryId!) || Money.zero(currency);
          const remaining = budgeted.subtract(spent);
          // FIX Money Rule 1: Keep Money through calculation
          const percentUsed = budgeted.isPositive()
            ? spent.divide(budgeted.toString()).multiply("100").toNumber()
            : 0;

          let status: "under_budget" | "near_limit" | "over_budget";
          if (percentUsed > 100) status = "over_budget";
          else if (percentUsed > 85) status = "near_limit";
          else status = "under_budget";

          return {
            categoryId: budget.categoryId!,
            categoryName: budget.categoryName || "Unknown",
            budgeted,
            spent,
            remaining,
            percentUsed,
            status,
          };
        });
    } catch (error) {
      logger.error("Failed to get budget status", { error, context });
      throw error;
    }
  }

  /**
   * Get recent transactions (last 20).
   */
  async getRecentTransactions(
    context: QueryContext,
    limit: number = 20,
  ): Promise<RecentTransactionResult[]> {
    try {
      const { householdId, currency, userId } = context;

      const txns = await db
        .select({
          id: transactions.id,
          date: transactions.date,
          name: transactions.name,
          amount: transactions.amount,
          categoryName: categories.name,
          merchantName: merchants.name,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
        .where(and(...transactionPrivacyFilters(householdId, userId)))
        .orderBy(desc(transactions.date), desc(transactions.createdAt))
        .limit(limit);

      return txns.map((txn) => ({
        transactionId: txn.id,
        date: txn.date,
        description: txn.name || "",
        amount: Money.from(txn.amount, currency),
        category: txn.categoryName || null,
        merchant: txn.merchantName || null,
      }));
    } catch (error) {
      logger.error("Failed to get recent transactions", { error, context });
      throw error;
    }
  }

  /**
   * Get account balances.
   */
  async getAccountBalances(
    context: QueryContext,
  ): Promise<AccountBalanceResult[]> {
    try {
      const { householdId, currency, userId } = context;

      const accountsList = await db
        .select()
        .from(accounts)
        .where(and(...accountPrivacyFilters(householdId, { userId })))
        .orderBy(accounts.isArchived, accounts.name);

      return accountsList.map((account) => ({
        accountId: account.id,
        accountName: account.name,
        accountType: account.type,
        balance: Money.from(account.balance, currency),
        isActive: !account.isArchived,
      }));
    } catch (error) {
      logger.error("Failed to get account balances", { error, context });
      throw error;
    }
  }

  /**
   * Get spending by merchant for a time period.
   */
  async getMerchantSpending(
    context: QueryContext,
    period: "30d" | "90d" | "12m",
    limit: number = 20,
  ): Promise<TopMerchantResult[]> {
    try {
      const { householdId, currency, userId } = context;
      const startDate = this.getPeriodStartDate(period);

      const results = await db
        .select({
          merchantId: transactions.merchantId,
          merchantName: merchants.name,
          total: sql<string>`SUM(${transactions.amount})`,
          count: sql<number>`COUNT(*)::int`,
          avgAmount: sql<string>`AVG(${transactions.amount})`,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
        .where(
          and(
            ...transactionPrivacyFilters(householdId, userId),
            eq(transactions.type, "expense"),
            gte(transactions.date, startDate),
          ),
        )
        .groupBy(transactions.merchantId, merchants.name)
        .orderBy(desc(sql`SUM(${transactions.amount})`))
        .limit(limit);

      return results
        .filter((row) => row.merchantId !== null)
        .map((row) => ({
          merchantId: row.merchantId!,
          merchantName: row.merchantName || "Unknown Merchant",
          totalSpent: Money.from(row.total, currency),
          transactionCount: row.count,
          avgTransactionAmount: Money.from(row.avgAmount, currency),
        }));
    } catch (error) {
      logger.error("Failed to get merchant spending", { error, context });
      throw error;
    }
  }

  /**
   * Get category spending trends over time.
   */
  async getCategoryTrends(
    context: QueryContext,
    months: number = 6,
    categoryId?: string,
  ): Promise<
    Array<{
      categoryId: string;
      categoryName: string;
      points: Array<{ month: string; amount: Money }>;
      trendDirection: "up" | "down" | "flat";
    }>
  > {
    try {
      const { householdId, currency, userId } = context;
      const startDate = format(subMonths(new Date(), months), "yyyy-MM-dd");

      // Build category filter
      const categoryFilter = categoryId
        ? eq(transactions.categoryId, categoryId)
        : undefined;

      const results = await db
        .select({
          categoryId: transactions.categoryId,
          categoryName: categories.name,
          month: sql<string>`TO_CHAR(${transactions.date}::date, 'YYYY-MM')`,
          total: sql<string>`SUM(${transactions.amount})`,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(
          and(
            ...transactionPrivacyFilters(householdId, userId),
            eq(transactions.type, "expense"),
            gte(transactions.date, startDate),
            categoryFilter,
          ),
        )
        .groupBy(
          transactions.categoryId,
          categories.name,
          sql`TO_CHAR(${transactions.date}::date, 'YYYY-MM')`,
        )
        .orderBy(sql`TO_CHAR(${transactions.date}::date, 'YYYY-MM')`);

      // Group by category
      const categoryMap = new Map<
        string,
        {
          categoryId: string;
          categoryName: string;
          points: Array<{ month: string; amount: Money }>;
        }
      >();

      for (const row of results) {
        if (!row.categoryId) continue;

        const key = row.categoryId;
        if (!categoryMap.has(key)) {
          categoryMap.set(key, {
            categoryId: row.categoryId,
            categoryName: row.categoryName || "Uncategorized",
            points: [],
          });
        }

        categoryMap.get(key)!.points.push({
          month: row.month,
          amount: Money.from(row.total, currency),
        });
      }

      // Calculate trend direction for each category
      return Array.from(categoryMap.values()).map((category) => {
        const points = category.points;
        let trendDirection: "up" | "down" | "flat" = "flat";

        if (points.length >= 2) {
          const firstHalf = points.slice(0, Math.floor(points.length / 2));
          const secondHalf = points.slice(Math.floor(points.length / 2));

          // FIX Money Rule 1: Use Money for aggregation, divide at end
          const firstSum = firstHalf.reduce(
            (sum, p) => sum.add(p.amount),
            Money.zero(currency),
          );
          const secondSum = secondHalf.reduce(
            (sum, p) => sum.add(p.amount),
            Money.zero(currency),
          );
          const firstAvg = firstSum.divide(firstHalf.length.toString());
          const secondAvg = secondSum.divide(secondHalf.length.toString());

          const change = firstAvg.isPositive()
            ? secondAvg
                .subtract(firstAvg)
                .divide(firstAvg.toString())
                .multiply("100")
                .toNumber()
            : 0;
          if (change > 10) trendDirection = "up";
          else if (change < -10) trendDirection = "down";
        }

        return {
          ...category,
          trendDirection,
        };
      });
    } catch (error) {
      logger.error("Failed to get category trends", { error, context });
      throw error;
    }
  }

  /**
   * Get monthly income vs expenses summary.
   */
  async getMonthlySummary(
    context: QueryContext,
    month?: string,
  ): Promise<MonthlyTrendResult> {
    try {
      const { householdId, currency, userId } = context;
      const targetMonth = month || format(new Date(), "yyyy-MM");
      const monthStart = `${targetMonth}-01`;
      const monthEnd = format(
        new Date(
          Number.parseInt(targetMonth.split("-")[0]),
          Number.parseInt(targetMonth.split("-")[1]),
          0,
        ),
        "yyyy-MM-dd",
      );

      // Get income
      const incomeResult = await db
        .select({
          total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .where(
          and(
            ...transactionPrivacyFilters(householdId, userId),
            eq(transactions.type, "income"),
            gte(transactions.date, monthStart),
            lte(transactions.date, monthEnd),
          ),
        );

      // Get expenses
      const expenseResult = await db
        .select({
          total: sql<string>`COALESCE(SUM(${transactions.amount}), '0')`,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .where(
          and(
            ...transactionPrivacyFilters(householdId, userId),
            eq(transactions.type, "expense"),
            gte(transactions.date, monthStart),
            lte(transactions.date, monthEnd),
          ),
        );

      const income = Money.from(incomeResult[0]?.total || "0", currency);
      const expenses = Money.from(expenseResult[0]?.total || "0", currency);
      const netSavings = income.subtract(expenses);
      // FIX Money Rule 1: Keep Money through calculation
      const savingsRate = income.isPositive()
        ? netSavings.divide(income.toString()).multiply("100").toNumber()
        : 0;

      return {
        month: targetMonth,
        income,
        expenses,
        netSavings,
        savingsRate,
      };
    } catch (error) {
      logger.error("Failed to get monthly summary", { error, context });
      throw error;
    }
  }

  /**
   * Search transactions by various filters.
   */
  async searchTransactions(
    context: QueryContext,
    params: {
      text?: string;
      categoryId?: string;
      merchantId?: string;
      dateFrom?: string;
      dateTo?: string;
      minAmount?: string;
      maxAmount?: string;
      limit?: number;
    },
  ): Promise<RecentTransactionResult[]> {
    try {
      const { householdId, currency, userId } = context;
      const {
        text,
        categoryId,
        merchantId,
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
        limit = 20,
      } = params;

      // Build dynamic filters
      const filters = [...transactionPrivacyFilters(householdId, userId)];

      if (text) {
        filters.push(sql`${transactions.name} ILIKE ${"%" + text + "%"}`);
      }
      if (categoryId) {
        filters.push(eq(transactions.categoryId, categoryId));
      }
      if (merchantId) {
        filters.push(eq(transactions.merchantId, merchantId));
      }
      if (dateFrom) {
        filters.push(gte(transactions.date, dateFrom));
      }
      if (dateTo) {
        filters.push(lte(transactions.date, dateTo));
      }
      if (minAmount) {
        filters.push(gte(transactions.amount, minAmount));
      }
      if (maxAmount) {
        filters.push(lte(transactions.amount, maxAmount));
      }

      const txns = await db
        .select({
          id: transactions.id,
          date: transactions.date,
          name: transactions.name,
          amount: transactions.amount,
          categoryName: categories.name,
          merchantName: merchants.name,
        })
        .from(transactions)
        .innerJoin(accounts, eq(transactions.accountId, accounts.id))
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .leftJoin(merchants, eq(transactions.merchantId, merchants.id))
        .where(and(...filters))
        .orderBy(desc(transactions.date), desc(transactions.createdAt))
        .limit(limit);

      return txns.map((txn) => ({
        transactionId: txn.id,
        date: txn.date,
        description: txn.name || "",
        amount: Money.from(txn.amount, currency),
        category: txn.categoryName || null,
        merchant: txn.merchantName || null,
      }));
    } catch (error) {
      logger.error("Failed to search transactions", { error, context });
      throw error;
    }
  }

  /**
   * Get goal-account assignments.
   */
  async getGoalAssignments(context: QueryContext): Promise<
    Array<{
      goalId: string;
      goalName: string;
      accountId: string | null;
      accountName: string | null;
      target: Money;
      current: Money;
    }>
  > {
    try {
      const { householdId, currency } = context;

      const goalsList = await db
        .select({
          goalId: goals.id,
          goalName: goals.name,
          accountId: goals.linkedAccountId,
          accountName: accounts.name,
          targetAmount: goals.targetAmount,
          currentAmount: goals.currentAmount,
        })
        .from(goals)
        .leftJoin(accounts, eq(goals.linkedAccountId, accounts.id))
        .where(and(...goalPrivacyFilters(householdId)));

      return goalsList.map((g) => ({
        goalId: g.goalId,
        goalName: g.goalName,
        accountId: g.accountId,
        accountName: g.accountName,
        target: Money.from(g.targetAmount, currency),
        current: Money.from(g.currentAmount, currency),
      }));
    } catch (error) {
      logger.error("Failed to get goal assignments", { error, context });
      throw error;
    }
  }

  /**
   * Get cash flow projection for upcoming months.
   */
  async getCashFlow(
    context: QueryContext,
    months: number = 3,
  ): Promise<
    Array<{
      month: string;
      inflow: Money;
      outflow: Money;
      net: Money;
      projectedEndingBalance: Money | null;
    }>
  > {
    try {
      const { householdId, currency } = context;

      // Get recurring transactions to project cash flow
      const recurrings = await db
        .select({
          amount: recurringTransactions.amount,
          type: recurringTransactions.type,
          frequency: recurringTransactions.frequency,
        })
        .from(recurringTransactions)
        .where(and(...recurringPrivacyFilters(householdId)));

      // Get current account balances
      const accountBalances = await this.getAccountBalances(context);
      const totalBalance = accountBalances.reduce(
        (sum, acc) => sum.add(acc.balance),
        Money.zero(currency),
      );

      // Generate projections for each month
      const projections: Array<{
        month: string;
        inflow: Money;
        outflow: Money;
        net: Money;
        projectedEndingBalance: Money | null;
      }> = [];

      let runningBalance = totalBalance;

      for (let i = 0; i < months; i++) {
        const targetMonth = format(subMonths(new Date(), -i - 1), "yyyy-MM");

        // Sum recurring incomes and expenses
        let monthlyInflow = Money.zero(currency);
        let monthlyOutflow = Money.zero(currency);

        for (const recurring of recurrings) {
          const amount = Money.from(recurring.amount, currency);

          // Simple frequency multiplier (assuming monthly for simplicity)
          // In production, would calculate based on actual frequency
          if (recurring.type === "income") {
            monthlyInflow = monthlyInflow.add(amount);
          } else {
            monthlyOutflow = monthlyOutflow.add(amount);
          }
        }

        const net = monthlyInflow.subtract(monthlyOutflow);
        runningBalance = runningBalance.add(net);

        projections.push({
          month: targetMonth,
          inflow: monthlyInflow,
          outflow: monthlyOutflow,
          net,
          projectedEndingBalance: runningBalance,
        });
      }

      return projections;
    } catch (error) {
      logger.error("Failed to get cash flow", { error, context });
      throw error;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private getPeriodStartDate(period: "7d" | "30d" | "90d" | "12m"): string {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case "7d":
        startDate = subDays(now, 7);
        break;
      case "30d":
        startDate = subDays(now, 30);
        break;
      case "90d":
        startDate = subDays(now, 90);
        break;
      case "12m":
        startDate = subMonths(now, 12);
        break;
    }

    return format(startDate, "yyyy-MM-dd");
  }
}
