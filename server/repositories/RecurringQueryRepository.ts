import { db } from "../db";
import {
  recurringTransactions,
  recurringTransactionHistory,
  recurringTransactionLinks,
  transactions,
  type RecurringTransaction,
  type RecurringTransactionHistory,
  type RecurringTransactionLink,
  type InsertRecurringTransactionHistory,
  type InsertRecurringTransactionLink,
} from "@shared/schema";
import { eq, and, desc, lte } from "drizzle-orm";
import { Money } from "../core/money";
import type {
  Frequency,
  IntervalUnit,
} from "../core/calculations/recurring/types";
import type { TransactionType } from "../utils/withTransaction";

/**
 * RecurringQueryRepository
 *
 * Data access layer for recurring transaction links, history, and summary queries.
 * Separated from RecurringRepository for LOC compliance.
 * Supports:
 * - Transaction link management
 * - History logging and retrieval
 * - Summary/analytics queries
 */
export class RecurringQueryRepository {
  /**
   * Create a link between a transaction and recurring rule
   */
  async createLink(
    data: InsertRecurringTransactionLink,
    tx?: TransactionType,
  ): Promise<RecurringTransactionLink> {
    const [link] = await (tx ?? db)
      .insert(recurringTransactionLinks)
      .values(data)
      .returning();
    return link;
  }

  /**
   * Find links for a recurring rule within a household
   */
  async findLinksByRecurring(
    recurringId: string,
    householdId: string,
  ): Promise<RecurringTransactionLink[]> {
    const results = await db
      .select({ link: recurringTransactionLinks })
      .from(recurringTransactionLinks)
      .innerJoin(
        recurringTransactions,
        eq(
          recurringTransactionLinks.recurringTransactionId,
          recurringTransactions.id,
        ),
      )
      .where(
        and(
          eq(recurringTransactions.householdId, householdId),
          eq(recurringTransactionLinks.recurringTransactionId, recurringId),
        ),
      )
      .orderBy(desc(recurringTransactionLinks.createdAt));

    return results.map((r) => r.link);
  }

  /**
   * Find a link by transaction within a household
   */
  async findLinkByTransaction(
    transactionId: string,
    householdId: string,
    tx?: TransactionType,
  ): Promise<RecurringTransactionLink | undefined> {
    const [result] = await (tx ?? db)
      .select({ link: recurringTransactionLinks })
      .from(recurringTransactionLinks)
      .innerJoin(
        transactions,
        eq(recurringTransactionLinks.transactionId, transactions.id),
      )
      .where(
        and(
          eq(transactions.householdId, householdId),
          eq(recurringTransactionLinks.transactionId, transactionId),
        ),
      )
      .limit(1);

    return result?.link;
  }

  /**
   * Delete a link by id with household validation
   */
  async deleteLink(
    linkId: string,
    householdId: string,
  ): Promise<
    | {
        id: string;
        transactionId: string;
        recurringTransactionId: string;
      }
    | undefined
  > {
    const [result] = await db
      .select({
        id: recurringTransactionLinks.id,
        transactionId: recurringTransactionLinks.transactionId,
        recurringTransactionId:
          recurringTransactionLinks.recurringTransactionId,
      })
      .from(recurringTransactionLinks)
      .innerJoin(
        recurringTransactions,
        eq(
          recurringTransactionLinks.recurringTransactionId,
          recurringTransactions.id,
        ),
      )
      .where(
        and(
          eq(recurringTransactionLinks.id, linkId),
          eq(recurringTransactions.householdId, householdId),
        ),
      )
      .limit(1);

    if (!result) return undefined;

    await db
      .delete(recurringTransactionLinks)
      .where(eq(recurringTransactionLinks.id, linkId));

    return result;
  }

  /**
   * Log a recurring history event
   */
  async logHistory(
    data: InsertRecurringTransactionHistory,
    tx?: TransactionType,
  ): Promise<RecurringTransactionHistory> {
    const [entry] = await (tx ?? db)
      .insert(recurringTransactionHistory)
      .values(data)
      .returning();
    return entry;
  }

  /**
   * Find history entries for a recurring rule
   */
  async findHistory(
    recurringId: string,
    householdId: string,
    limit: number = 50,
  ): Promise<RecurringTransactionHistory[]> {
    const results = await db
      .select({ history: recurringTransactionHistory })
      .from(recurringTransactionHistory)
      .innerJoin(
        recurringTransactions,
        eq(
          recurringTransactionHistory.recurringTransactionId,
          recurringTransactions.id,
        ),
      )
      .where(
        and(
          eq(recurringTransactions.householdId, householdId),
          eq(recurringTransactionHistory.recurringTransactionId, recurringId),
        ),
      )
      .orderBy(desc(recurringTransactionHistory.createdAt))
      .limit(limit);

    return results.map((r) => r.history);
  }

  /**
   * Recurring summary metrics
   */
  /**
   * Totals are in the household base currency and count only rules whose
   * denomination is proven in it (FIN-05); every other active rule is counted
   * in `excludedCount`, never summed as if it were the base currency.
   */
  summarize(
    rules: readonly { rule: RecurringTransaction; upcoming: boolean; currency: string | null }[],
    baseCurrency: string,
  ) {
    let monthlyIncome = Money.zero(baseCurrency);
    let monthlyExpenses = Money.zero(baseCurrency);
    let subscriptionCount = 0;
    let excludedCount = 0;

    let upcomingCount = 0;
    for (const { rule, upcoming, currency } of rules) {
      if (upcoming) upcomingCount++;
      if (rule.isSubscription) subscriptionCount++;
      if (currency !== baseCurrency) {
        excludedCount++;
        continue;
      }
      const ruleMoney = new Money(rule.amount, baseCurrency);

      const monthlyAmount = this.toMonthlyAmount(
        ruleMoney,
        rule.frequency as Frequency,
        rule.intervalValue ?? undefined,
        rule.intervalUnit as IntervalUnit | null,
      );

      if (rule.type === "income") {
        monthlyIncome = monthlyIncome.add(monthlyAmount);
      } else if (rule.type === "expense") {
        monthlyExpenses = monthlyExpenses.add(monthlyAmount);
      }
    }

    return {
      currency: baseCurrency,
      totalMonthlyIncome: monthlyIncome.toString(),
      totalMonthlyExpenses: monthlyExpenses.toString(),
      excludedCount,
      complete: excludedCount === 0,
      activeCount: rules.length,
      subscriptionCount,
      upcomingCount,
    };
  }

  private toMonthlyAmount(
    amount: Money,
    frequency: Frequency,
    intervalValue?: number | null,
    intervalUnit?: IntervalUnit | null,
  ): Money {
    switch (frequency) {
      case "daily":
        return amount.multiply(30);
      case "weekly":
        return amount.multiply("4.33");
      case "biweekly":
        return amount.multiply("2.17");
      case "monthly":
        return amount;
      case "quarterly":
        return amount.divide(3);
      case "yearly":
      case "annually":
        return amount.divide(12);
      case "semi_annually":
        return amount.divide(6);
      case "custom": {
        const value = Math.max(intervalValue ?? 1, 1);
        switch (intervalUnit) {
          case "days":
            return amount.multiply(30).divide(value);
          case "weeks":
            return amount.multiply("4.33").divide(value);
          case "months":
            return amount.divide(value);
          case "years":
            return amount.divide(12 * value);
          default:
            return amount;
        }
      }
      default:
        return amount;
    }
  }
}

// Export singleton instance
export const recurringQueryRepository = new RecurringQueryRepository();
