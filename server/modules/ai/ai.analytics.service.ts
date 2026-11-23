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
  accounts,
  recurringTransactions,
  categories,
  merchants,
} from "@shared/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { format } from "date-fns";
import { householdMonthRange, LEGACY_HOUSEHOLD_CALENDAR_ZONE, shiftCalendarDate } from "@shared/household-calendar";
import type {
  SpendingByCategoryResult,
  GoalStatusResult,
  GoalAssignmentResult,
  UpcomingRecurringResult,
  BudgetStatusResult,
  TopMerchantResult,
  MonthlyTrendResult,
  CategoryTrendResult,
  RecentTransactionResult,
  AccountBalanceResult,
  QueryContext,
} from "./ai.types";
import { logger } from "../../utils/logger";
import { readCurrentCategoryBudgetLimits } from "../../repositories/BudgetCurrentLimitRepository";
import { readBudgetMoney } from "../../core/money/budget-denomination";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { couponCashDescriptionFields } from "../../services/grz/couponCashDescription";
import { visibleRulePredicate } from "../../services/recurring/RecurringAudienceQuery";
import { householdToday } from "../../services/householdCalendarToday";
import {
  requireFinancialReadActor,
  transactionPrivacyFilters,
  accountPrivacyFilters,
  recurringPrivacyFilters,
} from "./ai.privacy-filters";
import { readGoalAssignments, readGoalsStatus } from "./ai.goal-readers";
import { projectCashFlow, type CashFlowPoint } from "./ai.cashflow-projection";
import { readCategorySpending, readCategoryTrends, readMerchantSpending, readMonthlySummary } from "./ai.flow-analytics";

function calendarMonth(date: string, offset = 0) {
  // This is already a household calendar date. Use UTC only for date arithmetic.
  return householdMonthRange(new Date(`${date}T00:00:00Z`), LEGACY_HOUSEHOLD_CALENDAR_ZONE, offset);
}

function monthsBefore(date: string, months: number): string {
  const { from, to } = calendarMonth(date, -months);
  const requestedDay = date.slice(8);
  const lastDay = to.slice(8);
  return `${from.slice(0, 8)}${requestedDay <= lastDay ? requestedDay : lastDay}`;
}

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
      return await readCategorySpending(context, await this.getPeriodRange(context, period));
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
      return await readGoalsStatus(requireFinancialReadActor(context), context.currency);
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
      const actor = requireFinancialReadActor(context);
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
            visibleRulePredicate(actor),
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
      const currentMonth = new Date().toISOString().slice(0, 7);
      const monthStart = `${currentMonth}-01`;
      const last = new Date(`${monthStart}T00:00:00Z`); last.setUTCMonth(last.getUTCMonth() + 1); last.setUTCDate(0);

      const limits = await readCurrentCategoryBudgetLimits(householdId, userId, currency, monthStart, last.toISOString().slice(0, 10));
      return limits.map(budget => {
        const budgeted = readBudgetMoney(budget.amount, budget.currency, currency);
        const spent = Money.from(budget.spent, currency);
        const remaining = budgeted.subtract(spent);
        // FIX Money Rule 1: Keep Money through calculation
        const percentUsed = budgeted.isPositive()
          ? spent.divide(budgeted.toString()).multiply("100").toNumber()
          : 0;

        let status: "under_budget" | "near_limit" | "over_budget";
        // Any spending against a zero budget is over it (no 0% "under budget").
        if (percentUsed > 100 || (!budgeted.isPositive() && spent.isPositive())) status = "over_budget";
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
      const { currency } = context;
      const filters = transactionPrivacyFilters(requireFinancialReadActor(context));

      const txns = await db
        .select({
          id: transactions.id,
          date: transactions.date,
          name: couponCashDescriptionFields().name,
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
      const { householdId, userId } = context;
      const actor = requireFinancialReadActor(context);

      const accountsList = await db
        .select()
        .from(accounts)
        .where(and(...accountPrivacyFilters(householdId, { userId }), visibleAccountPredicate(actor)))
        .orderBy(accounts.isArchived, accounts.name);

      return accountsList.map((account) => ({
        accountId: account.id,
        accountName: account.name,
        accountType: account.type,
        // Astra A-07: each balance in its own account's currency, never the household's.
        balance: Money.from(account.balance, account.currency),
        currency: account.currency,
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
      return await readMerchantSpending(context, await this.getPeriodRange(context, period), limit);
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
  ): Promise<CategoryTrendResult[]> {
    try {
      const today = await this.getHouseholdToday(context);
      return await readCategoryTrends(context, { from: monthsBefore(today, months), to: today }, categoryId);
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
      const today = await this.getHouseholdToday(context);
      const currentMonth = today.slice(0, 7);
      const targetMonth = month || currentMonth;
      const { from, to } = calendarMonth(`${targetMonth}-01`);
      return await readMonthlySummary(context, targetMonth, { from, to: targetMonth === currentMonth ? today : to });
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
      const { currency } = context;
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
      const filters = transactionPrivacyFilters(requireFinancialReadActor(context));

      if (text) {
        // R1-05: match the name the ledger shows, so a hidden instrument name is no oracle.
        filters.push(sql`${couponCashDescriptionFields().name} ILIKE ${"%" + text + "%"}`);
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
          name: couponCashDescriptionFields().name,
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
  async getGoalAssignments(context: QueryContext): Promise<GoalAssignmentResult[]> {
    try {
      return await readGoalAssignments(requireFinancialReadActor(context), context.currency);
    } catch (error) {
      logger.error("Failed to get goal assignments", { error, context });
      throw error;
    }
  }

  /**
   * Cash flow projection for the coming months (Astra A-07, A-40): see
   * ai.cashflow-projection.ts for how frequency and currency are handled.
   */
  async getCashFlow(context: QueryContext, months: number = 3): Promise<CashFlowPoint[]> {
    try {
      const actor = requireFinancialReadActor(context);
      const balances = await this.getAccountBalances(context);
      return await projectCashFlow({ actor, currency: context.currency, balances, months });
    } catch (error) {
      logger.error("Failed to get cash flow", { error, context });
      throw error;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private getHouseholdToday(context: QueryContext): Promise<string> {
    return householdToday(db, requireFinancialReadActor(context).householdId);
  }

  private async getPeriodRange(context: QueryContext, period: "7d" | "30d" | "90d" | "12m") {
    const to = await this.getHouseholdToday(context);
    const days = { "7d": 7, "30d": 30, "90d": 90 };
    const from = period === "12m" ? monthsBefore(to, 12) : shiftCalendarDate(to, -days[period]);
    return { from, to };
  }
}
